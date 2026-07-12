import * as assert from "node:assert";
import { test } from "node:test";
import { ticketRedisKeys } from "@repo/types/redis-keys";
import {
  calculateAvailableTickets,
  countActiveReservations,
  reconcileTicketAvailability,
  type EventInventorySnapshot,
  type ReconcileRedisClient,
} from "../../src/lib/reconcile-ticket-availability.ts";

type ScanResponse = [string, string[]];

function createRedisMock(
  scanResponses: ScanResponse[],
  getValues: Record<string, string | null> = {},
): ReconcileRedisClient & {
  scanCalls: Array<{
    cursor: string;
    pattern: string;
    count: number;
  }>;
  msetCalls: Array<Record<string, string>>;
  incrbyCalls: Array<{ key: string; increment: number }>;
  getCalls: string[];
} {
  const pendingScanResponses = [...scanResponses];
  const scanCalls: Array<{ cursor: string; pattern: string; count: number }> =
    [];
  const msetCalls: Array<Record<string, string>> = [];
  const incrbyCalls: Array<{ key: string; increment: number }> = [];
  const getCalls: string[] = [];

  return {
    scanCalls,
    msetCalls,
    incrbyCalls,
    getCalls,
    async get(key) {
      getCalls.push(key);
      return getValues[key] ?? null;
    },
    async scan(cursor, _matchToken, pattern, _countToken, count) {
      scanCalls.push({ cursor, pattern, count });

      const response = pendingScanResponses.shift();
      if (!response) {
        throw new Error("Missing scan response");
      }

      return response;
    },
    async mset(values) {
      msetCalls.push(values);
      return "OK";
    },
    async incrby(key, increment) {
      incrbyCalls.push({ key, increment });
      return 0;
    },
  };
}

void test("reconcile calculates available tickets and clamps the result at zero", () => {
  assert.equal(calculateAvailableTickets(100, 80, 10), 10);
  assert.equal(calculateAvailableTickets(100, 95, 10), 0);
});

void test("reconcile counts active reservations across paginated Redis scans", async () => {
  const eventId = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
  const reservationKeys = ticketRedisKeys(eventId);
  const redis = createRedisMock([
    [
      "17",
      [
        reservationKeys.reservation("order-1"),
        reservationKeys.reservation("order-2"),
      ],
    ],
    ["0", [reservationKeys.reservation("order-3")]],
  ]);

  const activeReservations = await countActiveReservations(redis, eventId, 25);

  assert.equal(activeReservations, 3);
  assert.deepEqual(redis.scanCalls, [
    {
      cursor: "0",
      pattern: `${reservationKeys.reservation("")}*`,
      count: 25,
    },
    {
      cursor: "17",
      pattern: `${reservationKeys.reservation("")}*`,
      count: 25,
    },
  ]);
});

void test("reconcile initializes total and available absolutely when the available key is missing", async () => {
  const eventId = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
  const keys = ticketRedisKeys(eventId);
  const redis = createRedisMock([["0", [keys.reservation("order-1")]]]);

  await reconcileTicketAvailability({
    getEventInventorySnapshots: async () => [
      { eventId, totalCapacity: 100, soldCount: 45 },
    ],
    redis,
    scanCount: 50,
  });

  assert.deepEqual(redis.msetCalls, [
    {
      [keys.total]: "100",
      [keys.available]: "54",
    },
  ]);
  assert.deepEqual(redis.incrbyCalls, []);
});

void test("reconcile corrects drift as a delta instead of overwriting the available counter", async () => {
  const eventSnapshots: [EventInventorySnapshot, EventInventorySnapshot] = [
    {
      eventId: "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b",
      totalCapacity: 100,
      soldCount: 45,
    },
    {
      eventId: "04c1ea10-6d1b-47c2-bd64-5e2cfaec4f64",
      totalCapacity: 20,
      soldCount: 18,
    },
  ];
  const firstKeys = ticketRedisKeys(eventSnapshots[0].eventId);
  const secondKeys = ticketRedisKeys(eventSnapshots[1].eventId);
  const redis = createRedisMock(
    [
      // Event 1: eine aktive Reservation → computed = 100 - 45 - 1 = 54
      ["0", [firstKeys.reservation("order-1")]],
      // Event 2: drei aktive Reservations → computed = 20 - 18 - 3 = 0 (clamped: -1 → 0)
      [
        "9",
        [secondKeys.reservation("order-2"), secondKeys.reservation("order-3")],
      ],
      ["0", [secondKeys.reservation("order-4")]],
    ],
    {
      // Redis zaehlt 60, korrekt waeren 54 → Drift +6 → INCRBY -6
      [firstKeys.available]: "60",
      // Redis zaehlt -2 (nach Ueberverkaufs-Fenster), korrekt 0 → Drift -2 → INCRBY +2
      [secondKeys.available]: "-2",
    },
  );

  await reconcileTicketAvailability({
    getEventInventorySnapshots: async () => eventSnapshots,
    redis,
    scanCount: 50,
  });

  assert.deepEqual(redis.msetCalls, [
    { [firstKeys.total]: "100" },
    { [secondKeys.total]: "20" },
  ]);
  assert.deepEqual(redis.incrbyCalls, [
    { key: firstKeys.available, increment: -6 },
    { key: secondKeys.available, increment: 2 },
  ]);
});

void test("reconcile leaves the available counter untouched when there is no drift", async () => {
  const eventId = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
  const keys = ticketRedisKeys(eventId);
  const redis = createRedisMock([["0", [keys.reservation("order-1")]]], {
    [keys.available]: "54",
  });

  await reconcileTicketAvailability({
    getEventInventorySnapshots: async () => [
      { eventId, totalCapacity: 100, soldCount: 45 },
    ],
    redis,
  });

  assert.deepEqual(redis.msetCalls, [{ [keys.total]: "100" }]);
  assert.deepEqual(redis.incrbyCalls, []);
});

void test("reconcile calls onEventReconciled with Redis and computed available counts", async () => {
  const eventId = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
  const keys = ticketRedisKeys(eventId);
  const redis = createRedisMock([["0", [keys.reservation("order-1")]]], {
    [keys.available]: "60",
  });

  const reconciledEvents: Array<{
    eventId: string;
    redisAvailable: number;
    computedAvailable: number;
  }> = [];

  await reconcileTicketAvailability({
    getEventInventorySnapshots: async () => [
      { eventId, totalCapacity: 100, soldCount: 45 },
    ],
    redis,
    onEventReconciled: (eid, redisAvailable, computedAvailable) => {
      reconciledEvents.push({
        eventId: eid,
        redisAvailable,
        computedAvailable,
      });
    },
  });

  assert.deepEqual(reconciledEvents, [
    { eventId, redisAvailable: 60, computedAvailable: 54 },
  ]);
  assert.deepEqual(redis.getCalls, [keys.available]);
});
