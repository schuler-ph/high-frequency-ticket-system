import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  failedOrderCacheEntrySchema,
  orderStatusResponseSchema,
  type BuyTicketEvent,
  type OrderCacheEntry,
} from "@repo/types/tickets";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import type { TicketRedisScripts } from "../../../apps/api/src/lib/redis-scripts.ts";
import errorHandler from "../../../apps/api/src/plugins/error-handler.ts";
import orderStatusRoute from "../../../apps/api/src/routes/api/orders/status.ts";
import ticketBuyRoute from "../../../apps/api/src/routes/api/tickets/buy.ts";
import { handleBuyTicketMessage } from "../../../apps/worker/src/lib/handle-buy-ticket-message.ts";

const EVENT_ID = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";

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

  return {
    store,
    defineCommand() {},
    async reserveTicket(
      availableKey,
      reservationKey,
      orderCacheKey,
      orderId,
      _reservationTtlSeconds,
      orderCacheValue,
      _pendingOrderTtlSeconds,
    ) {
      const current = Number(store.get(availableKey) ?? "0");

      if (current <= 0) {
        return -1;
      }

      const remaining = current - 1;
      store.set(availableKey, String(remaining));
      store.set(reservationKey, orderId);
      store.set(orderCacheKey, orderCacheValue);
      return remaining;
    },
    async releaseTicketReservation(
      reservationKey,
      availableKey,
      orderCacheKey,
    ) {
      const released = store.delete(reservationKey) ? 1 : 0;

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
  acked: boolean;
  nacked: boolean;
  ack: () => void;
  nack: () => void;
};

function createMessage(payload: BuyTicketEvent): TestMessage {
  const message: TestMessage = {
    id: "msg-1",
    data: Buffer.from(JSON.stringify(payload)),
    acked: false,
    nacked: false,
    ack() {
      message.acked = true;
    },
    nack() {
      message.nacked = true;
    },
  };

  return message;
}

void test("POST /api/tickets/:eventId/buy returns 409 when tickets are sold out and does not set reservation or order cache", async () => {
  const redis = createInMemoryRedis({
    [ticketRedisKeys(EVENT_ID).available]: "0",
  });
  let publishCalled = false;

  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis as unknown as typeof fastify.redis);
  fastify.decorate("pubsubPublisher", {
    async publishBuyTicket(_payload: BuyTicketEvent) {
      publishCalled = true;
      return "msg-1";
    },
  });

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
    assert.equal(publishCalled, false);
    // Only the availability key exists — no reservation or order cache was written
    assert.equal(redis.store.size, 1);
    assert.equal(redis.store.get(ticketRedisKeys(EVENT_ID).available), "0");
  } finally {
    await fastify.close();
  }
});

void test("POST /api/tickets/:eventId/buy rolls back reservation and restores availability when Pub/Sub publish fails", async () => {
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
  await fastify.ready();

  try {
    const response = await fastify.inject({
      method: "POST",
      url: `/api/tickets/${EVENT_ID}/buy`,
      payload: { firstName: "Ada", lastName: "Lovelace" },
    });

    assert.equal(response.statusCode, 500);
    // Availability restored: was 1, decremented to 0, then incremented back to 1
    assert.equal(redis.store.get(ticketRedisKeys(EVENT_ID).available), "1");
    // Only the availability key remains — reservation and order cache were deleted
    assert.equal(redis.store.size, 1);
  } finally {
    await fastify.close();
  }
});

void test("Worker compensates reservation and marks order as failed on terminal P0001 error, GET /api/orders/:orderId returns failed status", async () => {
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
  await fastify.register(orderStatusRoute, { prefix: "/api/orders" });
  await fastify.ready();

  try {
    const buyResponse = await fastify.inject({
      method: "POST",
      url: `/api/tickets/${EVENT_ID}/buy`,
      payload: { firstName: "Ada", lastName: "Lovelace" },
    });

    assert.equal(buyResponse.statusCode, 202);

    const buyBody = JSON.parse(buyResponse.body) as {
      orderId: string;
      message: string;
    };
    const orderId = buyBody.orderId;

    assert.equal(publishedEvents.length, 1);

    const workerMessage = createMessage(publishedEvents[0]!);
    await handleBuyTicketMessage(workerMessage, {
      logger: noopLogger,
      executeBuyTicket: async () => {
        throw new Error("Event not found", { cause: { code: "P0001" } });
      },
      compensateReservation: async () => "released",
      markOrderFailed: async () => "updated",
      isOrderProcessed: async () => false,
      tryAcquireProcessingLock: async () => true,
      writeOrderCacheEntry: async (entry: OrderCacheEntry) => {
        await redis.set(
          orderRedisKeys.entry(entry.orderId),
          JSON.stringify(entry),
          "EX",
          86400,
        );
      },
      markOrderProcessed: async () => undefined,
      releaseProcessingLock: async () => undefined,
      sleep: async () => undefined,
    });

    assert.equal(workerMessage.acked, true);
    assert.equal(workerMessage.nacked, false);

    const cachedFailedOrder = await redis.get(orderRedisKeys.entry(orderId));
    assert.notEqual(cachedFailedOrder, null);
    assert.deepEqual(
      JSON.parse(cachedFailedOrder!),
      failedOrderCacheEntrySchema.parse({
        orderId,
        eventId: EVENT_ID,
        status: "failed",
        failureReason: "Event not found",
      }),
    );

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
