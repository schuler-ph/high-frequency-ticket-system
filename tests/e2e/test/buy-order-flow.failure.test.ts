import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  orderStatusResponseSchema,
  type BuyTicketEvent,
  type OrderCacheEntry,
} from "@repo/types/tickets";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import errorHandler from "../../../apps/api/src/plugins/error-handler.ts";
import orderPayRoute from "../../../apps/api/src/routes/api/orders/pay.ts";
import orderStatusRoute from "../../../apps/api/src/routes/api/orders/status.ts";
import ticketBuyRoute from "../../../apps/api/src/routes/api/tickets/buy.ts";
import type { TicketRedisScripts } from "../../../apps/api/src/lib/redis-scripts.ts";
import { handleBuyTicketMessage } from "../../../apps/worker/src/lib/handle-buy-ticket-message.ts";

const EVENT_ID = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";

const FAKE_PAYMENT = {
  cardHolder: "Ada Lovelace",
  cardNumber: "4242 4242 4242 4242",
  expiry: "12/30",
  cvc: "123",
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

type TestMessage = {
  id: string;
  data: Buffer;
};

function createMessage(payload: BuyTicketEvent): TestMessage {
  return {
    id: "msg-1",
    data: Buffer.from(JSON.stringify(payload)),
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

void test("POST /api/orders/:orderId/pay rolls back the reservation and restores availability when Pub/Sub publish fails", async () => {
  const redis = createInMemoryRedis({
    [ticketRedisKeys(EVENT_ID).available]: "1",
  });

  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis as unknown as typeof fastify.redis);
  fastify.decorate("pubsubPublisher", {
    async publishBuyTicket(_payload: BuyTicketEvent): Promise<string> {
      throw new Error("Pub/Sub unavailable");
    },
  });

  await fastify.register(errorHandler);
  await fastify.register(ticketBuyRoute, { prefix: "/api/tickets" });
  await fastify.register(orderPayRoute, { prefix: "/api/orders" });
  await fastify.ready();

  try {
    const buyResponse = await fastify.inject({
      method: "POST",
      url: `/api/tickets/${EVENT_ID}/buy`,
      payload: { firstName: "Ada", lastName: "Lovelace" },
    });

    assert.equal(buyResponse.statusCode, 202);
    const { orderId } = JSON.parse(buyResponse.body) as { orderId: string };

    // Reserviert: available dekrementiert, Reservierungs-Record vorhanden.
    assert.equal(redis.store.get(ticketRedisKeys(EVENT_ID).available), "0");
    assert.equal(redis.store.size, 2);

    const payResponse = await fastify.inject({
      method: "POST",
      url: `/api/orders/${orderId}/pay`,
      payload: FAKE_PAYMENT,
    });

    assert.equal(payResponse.statusCode, 500);
    // Availability restored: was 1 → 0 (buy) → 1 (pay rollback).
    assert.equal(redis.store.get(ticketRedisKeys(EVENT_ID).available), "1");
    // Only the availability key remains — reservation and pending order deleted.
    assert.equal(redis.store.size, 1);
  } finally {
    await fastify.close();
  }
});

void test("worker compensates reservation and marks order failed on terminal P0001; GET /api/orders/:orderId returns failed", async () => {
  const redis = createInMemoryRedis({
    [ticketRedisKeys(EVENT_ID).available]: "1",
  });
  const publishedEvents: BuyTicketEvent[] = [];

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
    const buyResponse = await fastify.inject({
      method: "POST",
      url: `/api/tickets/${EVENT_ID}/buy`,
      payload: { firstName: "Ada", lastName: "Lovelace" },
    });
    assert.equal(buyResponse.statusCode, 202);
    const { orderId } = JSON.parse(buyResponse.body) as { orderId: string };

    const payResponse = await fastify.inject({
      method: "POST",
      url: `/api/orders/${orderId}/pay`,
      payload: FAKE_PAYMENT,
    });
    assert.equal(payResponse.statusCode, 200);
    assert.equal(publishedEvents.length, 1);

    const outcome = await handleBuyTicketMessage(
      createMessage(publishedEvents[0]!),
      {
        logger: noopLogger,
        executeBuyTicket: async () => {
          throw new Error("Event not found", { cause: { code: "P0001" } });
        },
        compensateReservation: async () => "released",
        markOrderFailed: async () => "updated",
        isOrderProcessed: async () => false,
        finalizeOrder: async (payload, entry: OrderCacheEntry) => {
          await redis.set(
            orderRedisKeys.entry(payload.orderId),
            JSON.stringify(entry),
            "EX",
            86400,
          );
        },
      },
    );

    assert.equal(outcome.kind, "terminal-failed");

    const orderResponse = await fastify.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
    });

    assert.equal(orderResponse.statusCode, 200);
    assert.deepEqual(
      JSON.parse(orderResponse.body),
      orderStatusResponseSchema.parse({
        orderId,
        eventId: EVENT_ID,
        status: "failed",
        failureReason: "Event not found",
      }),
    );
  } finally {
    await fastify.close();
  }
});
