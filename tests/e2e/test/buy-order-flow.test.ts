import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  completedOrderCacheEntrySchema,
  orderStatusResponseSchema,
  pendingOrderReservationSchema,
  type BuyTicketEvent,
  type OrderCacheEntry,
} from "@repo/types/tickets";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import type { TicketRedisScripts } from "../../../apps/api/src/lib/redis-scripts.ts";
import orderPayRoute from "../../../apps/api/src/routes/api/orders/pay.ts";
import orderStatusRoute from "../../../apps/api/src/routes/api/orders/status.ts";
import ticketBuyRoute from "../../../apps/api/src/routes/api/tickets/buy.ts";
import { handleBuyTicketMessage } from "../../../apps/worker/src/lib/handle-buy-ticket-message.ts";

type InMemoryRedis = Pick<
  RedisClient,
  "set" | "del" | "incr" | "get" | "defineCommand"
> &
  TicketRedisScripts;

type TestMessage = {
  id: string;
  data: Buffer;
};

const noopLogger: FastifyBaseLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  silent: () => undefined,
  child: () => noopLogger,
  level: "info",
} as unknown as FastifyBaseLogger;

// Fake/Dummy-Zahlungsdaten — reine Simulation, werden nie persistiert.
const FAKE_PAYMENT = {
  cardHolder: "Ada Lovelace",
  cardNumber: "4242 4242 4242 4242",
  expiry: "12/30",
  cvc: "123",
};

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

function createMessage(payload: BuyTicketEvent): TestMessage {
  return {
    id: "msg-1",
    data: Buffer.from(JSON.stringify(payload)),
  };
}

// Voller Reserve/Pay-Split-Flow (ADR-028): buy (reserve) → pay (publish) →
// Worker (persist) → GET /orders (Redis-Read des finalen Zustands).
void test("buy reserves, pay publishes, worker persists, and GET /api/orders/:orderId returns the completed ticket", async () => {
  const eventId = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";
  const ticketId = "e42628f4-3e01-4098-9696-19f6bb055ac3";
  const publishedEvents: BuyTicketEvent[] = [];
  const redis = createInMemoryRedis({
    [ticketRedisKeys(eventId).available]: "1",
  });
  const fastify = Fastify({ logger: false });

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis as unknown as typeof fastify.redis);
  fastify.decorate("pubsubPublisher", {
    async publishBuyTicket(payload: BuyTicketEvent) {
      publishedEvents.push(payload);
      return "msg-1";
    },
  });

  await fastify.register(ticketBuyRoute, { prefix: "/api/tickets" });
  await fastify.register(orderPayRoute, { prefix: "/api/orders" });
  await fastify.register(orderStatusRoute, { prefix: "/api/orders" });
  await fastify.ready();

  try {
    // 1. Buy → reserviert nur, published nichts.
    const buyResponse = await fastify.inject({
      method: "POST",
      url: `/api/tickets/${eventId}/buy`,
      payload: { firstName: "Ada", lastName: "Lovelace" },
    });

    assert.equal(buyResponse.statusCode, 202);
    const buyBody = JSON.parse(buyResponse.body) as {
      orderId: string;
      message: string;
    };
    assert.equal(buyBody.message, "Ticket reserved");
    assert.equal(publishedEvents.length, 0);

    // Reservierungs-Record traegt die Kaeuferdaten.
    assert.deepEqual(
      JSON.parse((await redis.get(orderRedisKeys.entry(buyBody.orderId)))!),
      pendingOrderReservationSchema.parse({
        orderId: buyBody.orderId,
        eventId,
        status: "pending",
        firstName: "Ada",
        lastName: "Lovelace",
      }),
    );

    // 2. Pay → published den BuyTicketEvent, antwortet synchron 200.
    const payResponse = await fastify.inject({
      method: "POST",
      url: `/api/orders/${buyBody.orderId}/pay`,
      payload: FAKE_PAYMENT,
    });

    assert.equal(payResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(payResponse.body), {
      confirmed: true,
      orderId: buyBody.orderId,
    });

    assert.equal(publishedEvents.length, 1);
    assert.ok(publishedEvents[0]);
    assert.equal(publishedEvents[0].orderId, buyBody.orderId);
    assert.equal(publishedEvents[0].eventId, eventId);
    assert.equal(publishedEvents[0].firstName, "Ada");
    assert.equal(publishedEvents[0].lastName, "Lovelace");
    assert.ok(
      typeof publishedEvents[0].queuedAt === "number" &&
        publishedEvents[0].queuedAt > 0,
    );

    // 3. Worker → persist-only (kein Sleep mehr), finalisiert in Redis.
    const outcome = await handleBuyTicketMessage(
      createMessage(publishedEvents[0]!),
      {
        logger: noopLogger,
        executeBuyTicket: async () => ticketId,
        compensateReservation: async () => "already-released",
        markOrderFailed: async () => "updated",
        isOrderProcessed: async () => false,
        finalizeOrder: async (payload, entry: OrderCacheEntry) => {
          await redis.set(
            orderRedisKeys.entry(payload.orderId),
            JSON.stringify(entry),
            "EX",
            3600,
          );
        },
      },
    );

    assert.equal(outcome.kind, "completed");

    // 4. GET /orders → finaler completed-Zustand aus Redis.
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
        status: "completed",
        ticketId,
      }),
    );
    assert.deepEqual(
      JSON.parse((await redis.get(orderRedisKeys.entry(buyBody.orderId)))!),
      completedOrderCacheEntrySchema.parse({
        orderId: buyBody.orderId,
        eventId,
        status: "completed",
        ticketId,
      }),
    );
  } finally {
    await fastify.close();
  }
});
