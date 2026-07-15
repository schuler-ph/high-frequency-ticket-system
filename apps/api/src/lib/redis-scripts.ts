import type { RedisClient } from "@repo/types/redis-client";

/**
 * Reserviert ein Ticket atomar in einem einzigen Redis-Roundtrip:
 * Check Sale-Unlock (`opensAt`) + Check `available > 0` + DECR +
 * Reservation-Key + Pending-Order-Key. Liefert den neuen `available`-Stand,
 * -1 bei Sold-Out, oder -2 wenn der Verkauf noch nicht freigegeben ist
 * (in beiden Fehlerfaellen wurde nichts geschrieben).
 *
 * KEYS[1] = available, KEYS[2] = reservationKey, KEYS[3] = orderCacheKey,
 * KEYS[4] = opensAtKey
 * ARGV[1] = orderId, ARGV[2] = reservationTtlSeconds,
 * ARGV[3] = orderCacheValue, ARGV[4] = pendingOrderTtlSeconds,
 * ARGV[5] = nowMs
 */
const RESERVE_TICKET_SCRIPT = `
local opensAt = tonumber(redis.call("GET", KEYS[4]) or "0")
if opensAt > 0 and tonumber(ARGV[5]) < opensAt then
  return -2
end

local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current <= 0 then
  return -1
end

local remaining = redis.call("DECR", KEYS[1])
redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[3], ARGV[3], "EX", ARGV[4])
return remaining
`;

/**
 * Gegen-Script zu RESERVE_TICKET_SCRIPT fuer den Publish-Fehlerpfad.
 * Idempotent: `available` wird nur zurueckgebucht, wenn der Reservation-Key
 * tatsaechlich noch existierte (kein Double-Increment bei Wiederholung).
 *
 * KEYS[1] = reservationKey, KEYS[2] = available, KEYS[3] = orderCacheKey
 */
const RELEASE_TICKET_RESERVATION_SCRIPT = `
local released = redis.call("DEL", KEYS[1])
if released == 1 then
  redis.call("INCR", KEYS[2])
end
redis.call("DEL", KEYS[3])
return released
`;

export type TicketRedisScripts = {
  reserveTicket(
    availableKey: string,
    reservationKey: string,
    orderCacheKey: string,
    opensAtKey: string,
    orderId: string,
    reservationTtlSeconds: number,
    orderCacheValue: string,
    pendingOrderTtlSeconds: number,
    nowMs: number,
  ): Promise<number>;
  releaseTicketReservation(
    reservationKey: string,
    availableKey: string,
    orderCacheKey: string,
  ): Promise<number>;
};

/**
 * Registriert beide Scripts einmalig via ioredis `defineCommand` (EVALSHA mit
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
  client.defineCommand("releaseTicketReservation", {
    numberOfKeys: 3,
    lua: RELEASE_TICKET_RESERVATION_SCRIPT,
  });

  return client as unknown as TicketRedisScripts;
};
