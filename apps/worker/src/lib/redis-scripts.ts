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
 * KEYS[1] = orderCacheKey, KEYS[2] = processedKey, KEYS[3] = reservationsLedger
 * ARGV[1] = orderCacheValue, ARGV[2] = orderCacheTtlSeconds,
 * ARGV[3] = orderId, ARGV[4] = processedTtlSeconds
 */
const FINALIZE_ORDER_PROCESSING_SCRIPT = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[4])
redis.call("ZREM", KEYS[3], ARGV[3])
return 1
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

  return client as unknown as WorkerRedisScripts;
};
