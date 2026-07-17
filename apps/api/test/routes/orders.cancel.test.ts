import * as assert from "node:assert";
import { test } from "node:test";
import {
  completedOrderCacheEntrySchema,
  pendingOrderReservationSchema,
} from "@repo/types/tickets";
import { ConflictError } from "@repo/types/errors";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import { cancelReservation } from "../../src/routes/api/orders/cancel.ts";

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
  releaseResult = 1,
): {
  get: (key: string) => Promise<string | null>;
  releaseTicketReservation: (
    reservationsLedgerKey: string,
    availableKey: string,
    orderCacheKey: string,
    orderId: string,
  ) => Promise<number>;
  releaseCalls: ReleaseCall[];
} {
  const releaseCalls: ReleaseCall[] = [];

  return {
    releaseCalls,
    async get() {
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
      return releaseResult;
    },
  };
}

void test("cancelReservation releases an active reservation and reports cancelled", async () => {
  const redis = createRedisMock(pendingReservationJson());
  let cancelledEventId: string | undefined;

  const response = await cancelReservation({
    orderId: ORDER_ID,
    redis,
    onCheckoutCancelled: (eventId) => {
      cancelledEventId = eventId;
    },
  });

  assert.deepEqual(response, { cancelled: true, orderId: ORDER_ID });
  assert.equal(cancelledEventId, EVENT_ID);
  assert.deepEqual(redis.releaseCalls, [
    {
      reservationsLedgerKey: ticketRedisKeys(EVENT_ID).reservations,
      availableKey: ticketRedisKeys(EVENT_ID).available,
      orderCacheKey: orderRedisKeys.entry(ORDER_ID),
      orderId: ORDER_ID,
    },
  ]);
});

void test("cancelReservation is idempotent when there is no reservation to cancel", async () => {
  const redis = createRedisMock(null);
  let cancelledFired = false;

  const response = await cancelReservation({
    orderId: ORDER_ID,
    redis,
    onCheckoutCancelled: () => {
      cancelledFired = true;
    },
  });

  assert.deepEqual(response, { cancelled: false, orderId: ORDER_ID });
  assert.equal(redis.releaseCalls.length, 0);
  assert.equal(cancelledFired, false);
});

void test("cancelReservation reports cancelled=false when the ledger entry was already gone", async () => {
  const redis = createRedisMock(pendingReservationJson(), 0);
  let cancelledFired = false;

  const response = await cancelReservation({
    orderId: ORDER_ID,
    redis,
    onCheckoutCancelled: () => {
      cancelledFired = true;
    },
  });

  assert.deepEqual(response, { cancelled: false, orderId: ORDER_ID });
  assert.equal(redis.releaseCalls.length, 1);
  // Kein Funnel-Zaehler, wenn faktisch nichts freigegeben wurde.
  assert.equal(cancelledFired, false);
});

void test("cancelReservation throws ConflictError for an already-finalized order", async () => {
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
    () => cancelReservation({ orderId: ORDER_ID, redis }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      return true;
    },
  );

  assert.equal(redis.releaseCalls.length, 0);
});
