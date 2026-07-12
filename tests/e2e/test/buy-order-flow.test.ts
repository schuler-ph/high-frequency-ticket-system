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
  type BuyTicketEvent,
  type OrderCacheEntry,
} from "@repo/types/tickets";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import type { TicketRedisScripts } from "../../../apps/api/src/lib/redis-scripts.ts";
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
  acked: boolean;
  nacked: boolean;
  ack: () => void;
  nack: () => void;
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

function createInMemoryRedis(
  initialValues: Record<string, string> = {},
): InMemoryRedis {
  const store = new Map<string, string>(Object.entries(initialValues));

  return {
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

void test("POST /api/tickets/:eventId/buy returns orderId and GET /api/orders/:orderId returns the final Redis-backed ticket state", async () => {
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
    assert.equal(buyBody.message, "Ticket purchase queued");
    assert.match(
      buyBody.orderId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

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

    const workerMessage = createMessage(publishedEvents[0]!);
    await handleBuyTicketMessage(workerMessage, {
      logger: noopLogger,
      executeBuyTicket: async () => ticketId,
      compensateReservation: async () => "already-released",
      markOrderFailed: async () => "updated",
      beginOrderProcessing: async () => "acquired",
      finalizeOrder: async (payload, entry: OrderCacheEntry) => {
        await redis.set(
          orderRedisKeys.entry(payload.orderId),
          JSON.stringify(entry),
          "EX",
          3600,
        );
      },
      releaseProcessingLock: async () => undefined,
      sleep: async () => undefined,
    });

    assert.equal(workerMessage.acked, true);
    assert.equal(workerMessage.nacked, false);

    const cachedCompletedOrder = await redis.get(
      orderRedisKeys.entry(buyBody.orderId),
    );
    assert.notEqual(cachedCompletedOrder, null);
    assert.deepEqual(
      JSON.parse(cachedCompletedOrder!),
      completedOrderCacheEntrySchema.parse({
        orderId: buyBody.orderId,
        eventId,
        status: "completed",
        ticketId,
      }),
    );

    const orderResponse = await fastify.inject({
      method: "GET",
      url: `/api/orders/${buyBody.orderId}`,
    });

    assert.equal(orderResponse.statusCode, 200);

    const orderBody = JSON.parse(orderResponse.body);
    assert.deepEqual(
      orderBody,
      orderStatusResponseSchema.parse({
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
