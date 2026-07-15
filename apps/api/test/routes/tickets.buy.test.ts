import * as assert from "node:assert";
import { test } from "node:test";
import {
  buyTicketBodySchema,
  pendingOrderCacheEntrySchema,
  type BuyTicketEvent,
} from "@repo/types/tickets";
import { ConflictError, TooEarlyError } from "@repo/types/errors";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import { queueBuyTicketPurchase } from "../../src/routes/api/tickets/buy.ts";
import {
  registerTicketRedisScripts,
  type TicketRedisScripts,
} from "../../src/lib/redis-scripts.ts";

const EVENT_ID = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";
const ORDER_ID = "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23";

type ReserveCall = {
  availableKey: string;
  reservationKey: string;
  orderCacheKey: string;
  opensAtKey: string;
  orderId: string;
  reservationTtlSeconds: number;
  orderCacheValue: string;
  pendingOrderTtlSeconds: number;
  nowMs: number;
};

type ReleaseCall = {
  reservationKey: string;
  availableKey: string;
  orderCacheKey: string;
};

function createScriptsMock(
  overrides: Partial<TicketRedisScripts> = {},
): TicketRedisScripts & {
  reserveCalls: ReserveCall[];
  releaseCalls: ReleaseCall[];
} {
  const reserveCalls: ReserveCall[] = [];
  const releaseCalls: ReleaseCall[] = [];

  return {
    reserveCalls,
    releaseCalls,
    async reserveTicket(
      availableKey,
      reservationKey,
      orderCacheKey,
      opensAtKey,
      orderId,
      reservationTtlSeconds,
      orderCacheValue,
      pendingOrderTtlSeconds,
      nowMs,
    ) {
      reserveCalls.push({
        availableKey,
        reservationKey,
        orderCacheKey,
        opensAtKey,
        orderId,
        reservationTtlSeconds,
        orderCacheValue,
        pendingOrderTtlSeconds,
        nowMs,
      });
      return 999_999;
    },
    async releaseTicketReservation(
      reservationKey,
      availableKey,
      orderCacheKey,
    ) {
      releaseCalls.push({ reservationKey, availableKey, orderCacheKey });
      return 1;
    },
    ...overrides,
  };
}

void test("queueBuyTicketPurchase reserves atomically in one script call and publishes the event", async () => {
  const redis = createScriptsMock();
  let publishedPayload: BuyTicketEvent | undefined;

  const response = await queueBuyTicketPurchase({
    eventId: EVENT_ID,
    body: {
      firstName: "Ada",
      lastName: "Lovelace",
    },
    redis,
    createOrderId: () => ORDER_ID,
    pubsubPublisher: {
      async publishBuyTicket(payload) {
        publishedPayload = payload;
        return "msg-1";
      },
    },
  });

  assert.equal(response.message, "Ticket purchase queued");
  assert.equal(response.orderId, ORDER_ID);
  assert.equal(redis.reserveCalls.length, 1);
  const reserveCall = redis.reserveCalls[0];
  assert.ok(reserveCall);
  assert.deepEqual(
    { ...reserveCall, nowMs: undefined },
    {
      availableKey: ticketRedisKeys(EVENT_ID).available,
      reservationKey: ticketRedisKeys(EVENT_ID).reservation(ORDER_ID),
      orderCacheKey: orderRedisKeys.entry(ORDER_ID),
      opensAtKey: ticketRedisKeys(EVENT_ID).opensAt,
      orderId: ORDER_ID,
      reservationTtlSeconds: 120,
      orderCacheValue: JSON.stringify(
        pendingOrderCacheEntrySchema.parse({
          orderId: ORDER_ID,
          eventId: EVENT_ID,
          status: "pending",
        }),
      ),
      pendingOrderTtlSeconds: 900,
      nowMs: undefined,
    },
  );
  assert.ok(
    typeof reserveCall.nowMs === "number" && reserveCall.nowMs > 0,
    `expected nowMs > 0, got ${String(reserveCall.nowMs)}`,
  );
  assert.equal(reserveCall.nowMs, publishedPayload?.queuedAt);
  assert.equal(redis.releaseCalls.length, 0);
  assert.ok(publishedPayload);
  assert.equal(publishedPayload.orderId, ORDER_ID);
  assert.equal(publishedPayload.eventId, EVENT_ID);
  assert.equal(publishedPayload.firstName, "Ada");
  assert.equal(publishedPayload.lastName, "Lovelace");
  assert.ok(
    typeof publishedPayload.queuedAt === "number" &&
      publishedPayload.queuedAt > 0,
  );
});

void test("queueBuyTicketPurchase throws ConflictError when sold out and publishes nothing", async () => {
  const redis = createScriptsMock({
    reserveTicket: async () => -1,
  });

  await assert.rejects(
    () =>
      queueBuyTicketPurchase({
        eventId: EVENT_ID,
        body: {
          firstName: "Ada",
          lastName: "Lovelace",
        },
        redis,
        pubsubPublisher: {
          async publishBuyTicket() {
            throw new Error("should not be called");
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.message, "Tickets sold out");
      return true;
    },
  );

  assert.equal(redis.releaseCalls.length, 0);
});

void test("queueBuyTicketPurchase throws TooEarlyError when the sale is not yet open and publishes nothing", async () => {
  const redis = createScriptsMock({
    reserveTicket: async () => -2,
  });

  await assert.rejects(
    () =>
      queueBuyTicketPurchase({
        eventId: EVENT_ID,
        body: {
          firstName: "Ada",
          lastName: "Lovelace",
        },
        redis,
        pubsubPublisher: {
          async publishBuyTicket() {
            throw new Error("should not be called");
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof TooEarlyError);
      assert.equal(error.message, "Tickets are not yet on sale");
      return true;
    },
  );

  assert.equal(redis.releaseCalls.length, 0);
});

void test("buyTicketBodySchema validates request body", () => {
  const result = buyTicketBodySchema.safeParse({
    firstName: "",
    lastName: "Lovelace",
  });

  assert.equal(result.success, false);
});

void test("queueBuyTicketPurchase releases the reservation atomically on publish failure", async () => {
  const redis = createScriptsMock();
  let rollbackMetricFired = 0;

  await assert.rejects(
    () =>
      queueBuyTicketPurchase({
        eventId: EVENT_ID,
        body: {
          firstName: "Ada",
          lastName: "Lovelace",
        },
        redis,
        createOrderId: () => ORDER_ID,
        onPublishRollback: () => {
          rollbackMetricFired += 1;
        },
        pubsubPublisher: {
          async publishBuyTicket() {
            throw new Error("pubsub unavailable");
          },
        },
      }),
    /pubsub unavailable/,
  );

  assert.deepEqual(redis.releaseCalls, [
    {
      reservationKey: ticketRedisKeys(EVENT_ID).reservation(ORDER_ID),
      availableKey: ticketRedisKeys(EVENT_ID).available,
      orderCacheKey: orderRedisKeys.entry(ORDER_ID),
    },
  ]);
  assert.equal(rollbackMetricFired, 1);
});

void test("queueBuyTicketPurchase aggregates publish and release errors when the rollback script fails", async () => {
  const redis = createScriptsMock({
    releaseTicketReservation: async () => {
      throw new Error("release failed");
    },
  });

  await assert.rejects(
    () =>
      queueBuyTicketPurchase({
        eventId: EVENT_ID,
        body: {
          firstName: "Ada",
          lastName: "Lovelace",
        },
        redis,
        pubsubPublisher: {
          async publishBuyTicket() {
            throw new Error("pubsub unavailable");
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(
        error.message,
        "Failed to queue ticket purchase and fully roll back reservation",
      );
      assert.equal(error.errors.length, 2);

      const [originalError, releaseError] = error.errors;

      assert.ok(originalError instanceof Error);
      assert.equal(originalError.message, "pubsub unavailable");
      assert.ok(releaseError instanceof Error);
      assert.equal(releaseError.message, "release failed");

      return true;
    },
  );
});

void test("registerTicketRedisScripts registers both scripts once via defineCommand", () => {
  const definedCommands: Array<{ name: string; numberOfKeys?: number }> = [];

  const scripts = registerTicketRedisScripts({
    defineCommand(name, definition) {
      definedCommands.push({ name, numberOfKeys: definition.numberOfKeys });
    },
  });

  assert.ok(scripts);
  assert.deepEqual(definedCommands, [
    { name: "reserveTicket", numberOfKeys: 4 },
    { name: "releaseTicketReservation", numberOfKeys: 3 },
  ]);
});
