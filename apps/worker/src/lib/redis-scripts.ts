import type { RedisClient } from "@repo/types/redis-client";

/**
 * Finaler Order-Zustand + `processed`-Marker in einem Redis-Roundtrip
 * (statt SET + SET sequenziell). Der `processed`-Marker ist eine reine
 * Redis-Optimierung fuer Redeliveries — die Idempotenz-Garantie selbst
 * traegt die `buy_ticket`-DB-Transaktion (ON CONFLICT, siehe ADR-004).
 *
 * KEYS[1] = orderCacheKey, KEYS[2] = processedKey
 * ARGV[1] = orderCacheValue, ARGV[2] = orderCacheTtlSeconds,
 * ARGV[3] = orderId, ARGV[4] = processedTtlSeconds
 */
const FINALIZE_ORDER_PROCESSING_SCRIPT = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[4])
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
  finalizeOrderProcessing(
    orderCacheKey: string,
    processedKey: string,
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
  client.defineCommand("finalizeOrderProcessing", {
    numberOfKeys: 2,
    lua: FINALIZE_ORDER_PROCESSING_SCRIPT,
  });
  client.defineCommand("compensateReservation", {
    numberOfKeys: 2,
    lua: COMPENSATE_RESERVATION_SCRIPT,
  });

  return client as unknown as WorkerRedisScripts;
};
