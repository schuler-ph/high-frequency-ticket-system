import type { RedisClient } from "@repo/types/redis-client";

/**
 * Finaler Order-Zustand + `processed`-Marker + Ledger-Bereinigung in einem
 * Redis-Roundtrip (statt sequenzieller Einzel-Calls). Der `processed`-Marker
 * ist eine reine Redis-Optimierung fuer Redeliveries — die Idempotenz-Garantie
 * selbst traegt die `buy_ticket`-DB-Transaktion (ON CONFLICT, siehe ADR-004).
 *
 * Das `ZREM` entfernt den Reservierungs-Anspruch aus dem Ledger, sobald die
 * Order finalisiert ist (Erfolg): Der Anspruch geht dann in `sold_count`
 * ueber und darf nicht doppelt (als aktive Reservierung UND als Verkauf)
 * zaehlen. Idempotent — ein zweiter Lauf entfernt nichts mehr (ADR-026).
 *
 * **Rueckgabewert = genau dieses `ZREM`-Ergebnis** und damit das
 * Erst-Finalisierung-Signal: `1` = der Ledger-Anspruch war noch da, diese
 * Nachricht hat die Order erstmalig abgeschlossen. `0` = der Anspruch war
 * bereits entfernt, es handelt sich also um eine erneute Auslieferung, die die
 * `buy_ticket`-Transaktion per `ON CONFLICT` idempotent absorbiert hat — fachlich
 * korrekt, aber eben *kein* zusaetzlich verkauftes Ticket.
 *
 * Dieselbe Idempotenz-Mechanik nutzt `COMPENSATE_RESERVATION_SCRIPT` unten
 * bereits. Bis Baseline B wurde der Wert verworfen (`return 1`), wodurch
 * `orders_completed_total` Duplikate als Verkaeufe zaehlte: 897.006 gemeldete
 * Completions gegen 867.575 real persistierte Tickets (+3,39 %), was zusaetzlich
 * die Grafana-Durchsatz-Panels und die Sold-Out-Erkennung verfaelschte
 * (docs/reports/baseline-b-2026-07-26, Report §4.3).
 *
 * KEYS[1] = orderCacheKey, KEYS[2] = processedKey, KEYS[3] = reservationsLedger
 * ARGV[1] = orderCacheValue, ARGV[2] = orderCacheTtlSeconds,
 * ARGV[3] = orderId, ARGV[4] = processedTtlSeconds
 */
const FINALIZE_ORDER_PROCESSING_SCRIPT = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[4])
return redis.call("ZREM", KEYS[3], ARGV[3])
`;

/**
 * Kompensation bei terminalem Business-Fehler. Idempotent: `available`
 * wird nur zurueckgebucht, wenn der Ledger-Eintrag noch existierte (`ZREM`
 * liefert 1 — kein Double-Increment bei Redelivery).
 *
 * KEYS[1] = reservationsLedger, KEYS[2] = availableKey
 * ARGV[1] = orderId
 */
const COMPENSATE_RESERVATION_SCRIPT = `
local removed = redis.call("ZREM", KEYS[1], ARGV[1])
if removed == 1 then
  redis.call("INCR", KEYS[2])
  return 1
end

return 0
`;

/**
 * Gibt genau einen faelligen Pending-Anspruch atomar frei. Deadline, Checkout-
 * Zustand, Ledger-Entfernung, Counter-Increment und Order-Cleanup liegen in
 * demselben Redis-Script; Pay/Cancel/Worker konkurrieren daher ohne
 * Check-then-act-Fenster (ADR-031).
 *
 * KEYS[1] = reservationsLedger, KEYS[2] = availableKey,
 * KEYS[3] = orderCacheKey
 * ARGV[1] = orderId, ARGV[2] = nowMs
 *
 * Return:
 *   1 released, 0 already gone, 2 not due, 3 missing state,
 *   4 publishing, 5 paid, 6 invalid/other state
 */
const REAP_PENDING_RESERVATION_SCRIPT = `
local deadline = redis.call("ZSCORE", KEYS[1], ARGV[1])
if not deadline then
  return 0
end
if tonumber(deadline) > tonumber(ARGV[2]) then
  return 2
end

local raw = redis.call("GET", KEYS[3])
if not raw then
  redis.call("ZADD", KEYS[1], 9007199254740991, ARGV[1])
  return 3
end

local decodedOk, order = pcall(cjson.decode, raw)
if not decodedOk or order["orderId"] ~= ARGV[1] then
  redis.call("ZADD", KEYS[1], 9007199254740991, ARGV[1])
  return 6
end
if order["status"] == "publishing" then
  redis.call("ZADD", KEYS[1], 9007199254740991, ARGV[1])
  return 4
end
if order["status"] == "paid" then
  redis.call("ZADD", KEYS[1], 9007199254740991, ARGV[1])
  return 5
end
if order["status"] ~= "pending" then
  redis.call("ZADD", KEYS[1], 9007199254740991, ARGV[1])
  return 6
end

local removed = redis.call("ZREM", KEYS[1], ARGV[1])
if removed == 0 then
  return 0
end
redis.call("INCR", KEYS[2])
redis.call("DEL", KEYS[3])
return 1
`;

export type WorkerRedisScripts = {
  finalizeOrderProcessing(
    orderCacheKey: string,
    processedKey: string,
    reservationsLedgerKey: string,
    orderCacheValue: string,
    orderCacheTtlSeconds: number,
    orderId: string,
    processedTtlSeconds: number,
  ): Promise<number>;
  compensateReservation(
    reservationsLedgerKey: string,
    availableKey: string,
    orderId: string,
  ): Promise<number>;
  reapPendingReservation(
    reservationsLedgerKey: string,
    availableKey: string,
    orderCacheKey: string,
    orderId: string,
    nowMs: number,
  ): Promise<number>;
};

/**
 * Registriert die Worker-Scripts einmalig via ioredis `defineCommand`
 * (EVALSHA mit automatischem Fallback). Der Cast ist die einzige Stelle,
 * an der die dynamisch erzeugten Command-Methoden typisiert werden.
 */
export const registerWorkerRedisScripts = (
  client: Pick<RedisClient, "defineCommand">,
): WorkerRedisScripts => {
  client.defineCommand("finalizeOrderProcessing", {
    numberOfKeys: 3,
    lua: FINALIZE_ORDER_PROCESSING_SCRIPT,
  });
  client.defineCommand("compensateReservation", {
    numberOfKeys: 2,
    lua: COMPENSATE_RESERVATION_SCRIPT,
  });
  client.defineCommand("reapPendingReservation", {
    numberOfKeys: 3,
    lua: REAP_PENDING_RESERVATION_SCRIPT,
  });

  return client as unknown as WorkerRedisScripts;
};
