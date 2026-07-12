import type { RedisClient } from "@repo/types/redis-client";

/**
 * Idempotenz-Check + Processing-Lock in einem Redis-Roundtrip.
 * Liefert "duplicate", wenn die Order bereits final verarbeitet wurde
 * (`processed`-Marker existiert), "acquired" bei erfolgreichem Lock,
 * sonst "locked" (parallele Zustellung haelt den Lock).
 *
 * KEYS[1] = processedKey, KEYS[2] = processingKey
 * ARGV[1] = orderId, ARGV[2] = lockTtlSeconds
 */
const BEGIN_ORDER_PROCESSING_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return "duplicate"
end

if redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2], "NX") then
  return "acquired"
end

return "locked"
`;

/**
 * Finaler Order-Zustand + `processed`-Marker + Lock-Release in einem
 * Redis-Roundtrip (statt SET + SET + DEL sequenziell).
 *
 * KEYS[1] = orderCacheKey, KEYS[2] = processedKey, KEYS[3] = processingKey
 * ARGV[1] = orderCacheValue, ARGV[2] = orderCacheTtlSeconds,
 * ARGV[3] = orderId, ARGV[4] = processedTtlSeconds
 */
const FINALIZE_ORDER_PROCESSING_SCRIPT = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[4])
redis.call("DEL", KEYS[3])
return 1
`;

/**
 * Kompensation bei terminalem Business-Fehler. Idempotent: `available`
 * wird nur zurueckgebucht, wenn der Reservation-Key noch existierte
 * (kein Double-Increment bei Redelivery).
 *
 * KEYS[1] = reservationKey, KEYS[2] = availableKey
 */
const COMPENSATE_RESERVATION_SCRIPT = `
local deleted = redis.call("DEL", KEYS[1])
if deleted == 1 then
  redis.call("INCR", KEYS[2])
  return 1
end

return 0
`;

export type WorkerRedisScripts = {
  beginOrderProcessing(
    processedKey: string,
    processingKey: string,
    orderId: string,
    lockTtlSeconds: number,
  ): Promise<"duplicate" | "acquired" | "locked">;
  finalizeOrderProcessing(
    orderCacheKey: string,
    processedKey: string,
    processingKey: string,
    orderCacheValue: string,
    orderCacheTtlSeconds: number,
    orderId: string,
    processedTtlSeconds: number,
  ): Promise<number>;
  compensateReservation(
    reservationKey: string,
    availableKey: string,
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
  client.defineCommand("beginOrderProcessing", {
    numberOfKeys: 2,
    lua: BEGIN_ORDER_PROCESSING_SCRIPT,
  });
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
