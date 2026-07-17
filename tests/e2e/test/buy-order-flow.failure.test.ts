import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import type { TicketRedisScripts } from "../../../apps/api/src/lib/redis-scripts.ts";
import errorHandler from "../../../apps/api/src/plugins/error-handler.ts";
import ticketBuyRoute from "../../../apps/api/src/routes/api/tickets/buy.ts";

const EVENT_ID = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";

type InMemoryRedis = Pick<
  RedisClient,
  "set" | "del" | "incr" | "get" | "defineCommand"
> &
  TicketRedisScripts & {
    store: Map<string, string>;
  };

function createInMemoryRedis(
  initialValues: Record<string, string> = {},
): InMemoryRedis {
  const store = new Map<string, string>(Object.entries(initialValues));
  // ZSet-Ledger als Set von orderIds pro Ledger-Key (ADR-026).
  const ledger = new Map<string, Set<string>>();

  return {
    store,
    defineCommand() {},
    async reserveTicket(
      availableKey,
      reservationsLedgerKey,
      orderCacheKey,
      _opensAtKey,
      orderId,
      orderCacheValue,
      _pendingOrderTtlSeconds,
      _nowMs,
    ) {
      const current = Number(store.get(availableKey) ?? "0");

      if (current <= 0) {
        return -1;
      }

      const remaining = current - 1;
      store.set(availableKey, String(remaining));
      const entries = ledger.get(reservationsLedgerKey) ?? new Set<string>();
      entries.add(orderId);
      ledger.set(reservationsLedgerKey, entries);
      store.set(orderCacheKey, orderCacheValue);
      return remaining;
    },
    async releaseTicketReservation(
      reservationsLedgerKey,
      availableKey,
      orderCacheKey,
      orderId,
    ) {
      const released = ledger.get(reservationsLedgerKey)?.delete(orderId)
        ? 1
        : 0;

      if (released === 1) {
        store.set(
          availableKey,
          String(Number(store.get(availableKey) ?? "0") + 1),
        );
      }

      store.delete(orderCacheKey);
      return released;
    },
    async set(key: string, value: string, mode: "EX", _seconds: number) {
      assert.equal(mode, "EX");
      store.set(key, value);
      return "OK";
    },
    async del(key: string) {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    },
    async incr(key: string) {
      const next = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(next));
      return next;
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
  };
}

void test("POST /api/tickets/:eventId/buy returns 409 when tickets are sold out and does not set reservation or order cache", async () => {
  const redis = createInMemoryRedis({
    [ticketRedisKeys(EVENT_ID).available]: "0",
  });

  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis as unknown as typeof fastify.redis);

  await fastify.register(errorHandler);
  await fastify.register(ticketBuyRoute, { prefix: "/api/tickets" });
  await fastify.ready();

  try {
    const response = await fastify.inject({
      method: "POST",
      url: `/api/tickets/${EVENT_ID}/buy`,
      payload: { firstName: "Ada", lastName: "Lovelace" },
    });

    assert.equal(response.statusCode, 409);
    // Only the availability key exists — no reservation or order cache was written
    assert.equal(redis.store.size, 1);
    assert.equal(redis.store.get(ticketRedisKeys(EVENT_ID).available), "0");
  } finally {
    await fastify.close();
  }
});
