import * as assert from "node:assert";
import { test } from "node:test";
import {
  pendingOrderReservationSchema,
  completedOrderCacheEntrySchema,
  type BuyTicketEvent,
} from "@repo/types/tickets";
import { ConflictError, NotFoundError } from "@repo/types/errors";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import { confirmPayment } from "../../src/routes/api/orders/pay.ts";

const EVENT_ID = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";
const ORDER_ID = "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23";

type ReleaseCall = {
  reservationsLedgerKey: string;
  availableKey: string;
  orderCacheKey: string;
  orderId: string;
};

function pendingReservationJson(): string {
  return JSON.stringify(
    pendingOrderReservationSchema.parse({
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      status: "pending",
      firstName: "Ada",
      lastName: "Lovelace",
    }),
  );
}

function createRedisMock(
  cachedValue: string | null,
  releaseOverride?: () => Promise<number>,
): {
  get: (key: string) => Promise<string | null>;
  releaseTicketReservation: (
    reservationsLedgerKey: string,
    availableKey: string,
    orderCacheKey: string,
    orderId: string,
  ) => Promise<number>;
  getCalls: string[];
  releaseCalls: ReleaseCall[];
} {
  const getCalls: string[] = [];
  const releaseCalls: ReleaseCall[] = [];

  return {
    getCalls,
    releaseCalls,
    async get(key) {
      getCalls.push(key);
      return cachedValue;
    },
    async releaseTicketReservation(
      reservationsLedgerKey,
      availableKey,
      orderCacheKey,
      orderId,
    ) {
      releaseCalls.push({
        reservationsLedgerKey,
        availableKey,
        orderCacheKey,
        orderId,
      });
      if (releaseOverride) {
        return releaseOverride();
      }
      return 1;
    },
  };
}

void test("confirmPayment publishes the BuyTicketEvent and returns confirmed", async () => {
  const redis = createRedisMock(pendingReservationJson());
  let publishedPayload: BuyTicketEvent | undefined;
  let confirmedEventId: string | undefined;

  const response = await confirmPayment({
    orderId: ORDER_ID,
    redis,
    createQueuedAt: () => 1_700_000_000_000,
    onPaymentConfirmed: (eventId) => {
      confirmedEventId = eventId;
    },
    pubsubPublisher: {
      async publishBuyTicket(payload) {
        publishedPayload = payload;
        return "msg-1";
      },
    },
  });

  assert.deepEqual(response, { confirmed: true, orderId: ORDER_ID });
  assert.deepEqual(redis.getCalls, [orderRedisKeys.entry(ORDER_ID)]);
  assert.equal(redis.releaseCalls.length, 0);
  assert.equal(confirmedEventId, EVENT_ID);
  assert.ok(publishedPayload);
  assert.deepEqual(publishedPayload, {
    orderId: ORDER_ID,
    eventId: EVENT_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    queuedAt: 1_700_000_000_000,
  });
});

void test("confirmPayment throws NotFoundError when the reservation is missing", async () => {
  const redis = createRedisMock(null);

  await assert.rejects(
    () =>
      confirmPayment({
        orderId: ORDER_ID,
        redis,
        pubsubPublisher: {
          async publishBuyTicket() {
            throw new Error("should not be called");
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundError);
      return true;
    },
  );

  assert.equal(redis.releaseCalls.length, 0);
});

void test("confirmPayment throws ConflictError when the order is not awaiting payment", async () => {
  const redis = createRedisMock(
    JSON.stringify(
      completedOrderCacheEntrySchema.parse({
        orderId: ORDER_ID,
        eventId: EVENT_ID,
        status: "completed",
        ticketId: "e42628f4-3e01-4098-9696-19f6bb055ac3",
      }),
    ),
  );

  await assert.rejects(
    () =>
      confirmPayment({
        orderId: ORDER_ID,
        redis,
        pubsubPublisher: {
          async publishBuyTicket() {
            throw new Error("should not be called");
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      return true;
    },
  );
});

void test("confirmPayment rolls back the reservation on publish failure", async () => {
  const redis = createRedisMock(pendingReservationJson());
  let rollbackEventId: string | undefined;

  await assert.rejects(
    () =>
      confirmPayment({
        orderId: ORDER_ID,
        redis,
        onPublishRollback: (eventId) => {
          rollbackEventId = eventId;
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
      reservationsLedgerKey: ticketRedisKeys(EVENT_ID).reservations,
      availableKey: ticketRedisKeys(EVENT_ID).available,
      orderCacheKey: orderRedisKeys.entry(ORDER_ID),
      orderId: ORDER_ID,
    },
  ]);
  assert.equal(rollbackEventId, EVENT_ID);
});

void test("confirmPayment aggregates publish and release errors when the rollback fails", async () => {
  const redis = createRedisMock(pendingReservationJson(), async () => {
    throw new Error("release failed");
  });

  await assert.rejects(
    () =>
      confirmPayment({
        orderId: ORDER_ID,
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
        "Failed to confirm payment and fully roll back reservation",
      );
      assert.equal(error.errors.length, 2);
      return true;
    },
  );
});
