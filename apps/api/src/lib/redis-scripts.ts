import type { RedisClient } from "@repo/types/redis-client";

/**
 * Reserviert ein Ticket atomar in einem einzigen Redis-Roundtrip:
 * Check Sale-Unlock (`opensAt`) + Check `available > 0` + DECR +
 * Ledger-Eintrag (`ZADD`, Score = Eligibility Deadline) + Pending-Order-Key.
 * Liefert den
 * neuen `available`-Stand, -1 bei Sold-Out, oder -2 wenn der Verkauf noch
 * nicht freigegeben ist (in beiden Fehlerfaellen wurde nichts geschrieben).
 *
 * Der Ledger-Eintrag hat bewusst KEINE TTL: er bleibt ein Inventar-Anspruch,
 * bis der Worker die Order finalisiert oder kompensiert (ADR-026). So kann
 * lange Warteschlangen-Latenz keine noch offene Reservierung "ablaufen"
 * lassen und der Reconcile-Loop bucht kein Inventar faelschlich zurueck.
 *
 * KEYS[1] = available, KEYS[2] = reservationsLedger, KEYS[3] = orderCacheKey,
 * KEYS[4] = opensAtKey
 * ARGV[1] = orderId, ARGV[2] = orderCacheValue,
 * ARGV[3] = pendingTimeoutSeconds, ARGV[4] = nowMs
 */
const RESERVE_TICKET_SCRIPT = `
local opensAt = tonumber(redis.call("GET", KEYS[4]) or "0")
if opensAt > 0 and tonumber(ARGV[4]) < opensAt then
  return -2
end

local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current <= 0 then
  return -1
end

local remaining = redis.call("DECR", KEYS[1])
local deadline = tonumber(ARGV[4]) + tonumber(ARGV[3]) * 1000
redis.call("ZADD", KEYS[2], deadline, ARGV[1])
redis.call("SET", KEYS[3], ARGV[2])
return remaining
`;

/**
 * Atomarer Pay-Claim: nur `pending` darf zu `publishing` wechseln. Das Script
 * liefert den geclaimten Record zurueck, damit die Route zwischen Zustandscheck
 * und Publish keinen zweiten GET-Race oeffnet.
 *
 * Das SET entfernt bewusst die Pending-TTL: ein `publishing`-Anspruch darf nie
 * altersbedingt verschwinden oder freigegeben werden. Der Worker ersetzt den
 * Key nach Finalisierung durch das begrenzte finale Read-Model.
 *
 * KEYS[1] = orderCacheKey
 * ARGV[1] = queuedAt
 *
 * Return: {1, claimedJson} | {0, false} (missing) | {-1, raw} (conflict)
 */
const CLAIM_PAYMENT_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return {0, false}
end

local decodedOk, order = pcall(cjson.decode, raw)
if not decodedOk or order["status"] ~= "pending" then
  return {-1, raw}
end

order["status"] = "publishing"
order["queuedAt"] = tonumber(ARGV[1])
local claimed = cjson.encode(order)
redis.call("SET", KEYS[1], claimed)
return {1, claimed}
`;

/**
 * Nach bestaetigtem Pub/Sub-Publish wird `publishing → paid` markiert. Falls
 * der Worker den Key bereits finalisiert hat, ist der No-op korrekt.
 *
 * KEYS[1] = orderCacheKey
 * Return: 1 = transitioned, 0 = state changed/missing
 */
const MARK_PAYMENT_PUBLISHED_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return 0
end

local decodedOk, order = pcall(cjson.decode, raw)
if not decodedOk or order["status"] ~= "publishing" then
  return 0
end

order["status"] = "paid"
redis.call("SET", KEYS[1], cjson.encode(order))
return 1
`;

/**
 * Zustandsbewusstes Gegen-Script zu RESERVE_TICKET_SCRIPT.
 * Idempotent: `available` wird nur zurueckgebucht, wenn der Ledger-Eintrag
 * tatsaechlich noch existierte (`ZREM` liefert 1 — kein Double-Increment bei
 * Wiederholung). Cancel darf nur `pending`, der Publish-Fehlerpfad nur den
 * eigenen `publishing`-Claim freigeben. Damit kann ein vorgelagerter GET-Race
 * nie eine inzwischen publizierende Order freigeben.
 *
 * KEYS[1] = reservationsLedger, KEYS[2] = available, KEYS[3] = orderCacheKey
 * ARGV[1] = orderId, ARGV[2] = expectedStatus
 * Return: 1 = released, 0 = nothing left, -1 = state conflict
 */
const RELEASE_TICKET_RESERVATION_SCRIPT = `
local raw = redis.call("GET", KEYS[3])
if not raw then
  return 0
end

local decodedOk, order = pcall(cjson.decode, raw)
if not decodedOk or order["orderId"] ~= ARGV[1] or order["status"] ~= ARGV[2] then
  return -1
end

local released = redis.call("ZREM", KEYS[1], ARGV[1])
if released == 1 then
  redis.call("INCR", KEYS[2])
end
redis.call("DEL", KEYS[3])
return released
`;

export type TicketRedisScripts = {
  reserveTicket(
    availableKey: string,
    reservationsLedgerKey: string,
    orderCacheKey: string,
    opensAtKey: string,
    orderId: string,
    orderCacheValue: string,
    pendingTimeoutSeconds: number,
    nowMs: number,
  ): Promise<number>;
  claimPayment(
    orderCacheKey: string,
    queuedAt: number,
  ): Promise<[result: number, claimedJson: string | null]>;
  markPaymentPublished(orderCacheKey: string): Promise<number>;
  releaseTicketReservation(
    reservationsLedgerKey: string,
    availableKey: string,
    orderCacheKey: string,
    orderId: string,
    expectedStatus: "pending" | "publishing",
  ): Promise<number>;
};

/**
 * Registriert die Checkout-Scripts einmalig via ioredis `defineCommand` (EVALSHA mit
 * automatischem Fallback — der Script-Text geht nicht bei jedem Request ueber
 * die Leitung). Der Cast ist die einzige Stelle, an der die dynamisch
 * erzeugten Command-Methoden typisiert werden.
 */
export const registerTicketRedisScripts = (
  client: Pick<RedisClient, "defineCommand">,
): TicketRedisScripts => {
  client.defineCommand("reserveTicket", {
    numberOfKeys: 4,
    lua: RESERVE_TICKET_SCRIPT,
  });
  client.defineCommand("claimPayment", {
    numberOfKeys: 1,
    lua: CLAIM_PAYMENT_SCRIPT,
  });
  client.defineCommand("markPaymentPublished", {
    numberOfKeys: 1,
    lua: MARK_PAYMENT_PUBLISHED_SCRIPT,
  });
  client.defineCommand("releaseTicketReservation", {
    numberOfKeys: 3,
    lua: RELEASE_TICKET_RESERVATION_SCRIPT,
  });

  return client as unknown as TicketRedisScripts;
};
