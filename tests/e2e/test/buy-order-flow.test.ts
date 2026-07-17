import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  orderStatusResponseSchema,
  pendingOrderReservationSchema,
} from "@repo/types/tickets";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import type { TicketRedisScripts } from "../../../apps/api/src/lib/redis-scripts.ts";
import orderStatusRoute from "../../../apps/api/src/routes/api/orders/status.ts";
import ticketBuyRoute from "../../../apps/api/src/routes/api/tickets/buy.ts";

type InMemoryRedis = Pick<
  RedisClient,
  "set" | "del" | "incr" | "get" | "defineCommand"
> &
  TicketRedisScripts;

function createInMemoryRedis(
  initialValues: Record<string, string> = {},
): InMemoryRedis {
  const store = new Map<string, string>(Object.entries(initialValues));
  // ZSet-Ledger als Set von orderIds pro Ledger-Key (ADR-026).
  const ledger = new Map<string, Set<string>>();

  return {
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

// Nach dem Reserve/Pay-Split (ADR-028) reserviert `POST /buy` nur noch und
// published NICHTS. Der volle Flow (buy → pay → Worker → completed) wird durch
// die Pay-Route-Tests abgedeckt, sobald diese existiert.
void test("POST /api/tickets/:eventId/buy reserves a ticket (no publish) and GET /api/orders/:orderId returns the pending order", async () => {
  const eventId = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";
  const redis = createInMemoryRedis({
    [ticketRedisKeys(eventId).available]: "1",
  });
  const fastify = Fastify({ logger: false });

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis as unknown as typeof fastify.redis);

  await fastify.register(ticketBuyRoute, { prefix: "/api/tickets" });
  await fastify.register(orderStatusRoute, { prefix: "/api/orders" });
  await fastify.ready();

  try {
    const buyResponse = await fastify.inject({
      method: "POST",
      url: `/api/tickets/${eventId}/buy`,
      payload: {
        firstName: "Ada",
        lastName: "Lovelace",
      },
    });

    assert.equal(buyResponse.statusCode, 202);

    const buyBody = JSON.parse(buyResponse.body) as {
      orderId: string;
      message: string;
    };
    assert.equal(buyBody.message, "Ticket reserved");
    assert.match(
      buyBody.orderId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Availability wurde atomar dekrementiert.
    assert.equal(await redis.get(ticketRedisKeys(eventId).available), "0");

    // Der Reservierungs-Record traegt die Kaeuferdaten fuer die Pay-Route.
    const cachedReservation = await redis.get(
      orderRedisKeys.entry(buyBody.orderId),
    );
    assert.notEqual(cachedReservation, null);
    assert.deepEqual(
      JSON.parse(cachedReservation!),
      pendingOrderReservationSchema.parse({
        orderId: buyBody.orderId,
        eventId,
        status: "pending",
        firstName: "Ada",
        lastName: "Lovelace",
      }),
    );

    // Der oeffentliche Status-Contract streift die Kaeuferdaten wieder ab.
    const orderResponse = await fastify.inject({
      method: "GET",
      url: `/api/orders/${buyBody.orderId}`,
    });

    assert.equal(orderResponse.statusCode, 200);
    assert.deepEqual(
      JSON.parse(orderResponse.body),
      orderStatusResponseSchema.parse({
        orderId: buyBody.orderId,
        eventId,
        status: "pending",
      }),
    );
  } finally {
    await fastify.close();
  }
});
