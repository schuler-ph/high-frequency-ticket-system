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
): ReconcileRedisClient & {
  scanCalls: Array<{
    cursor: string;
    pattern: string;
    count: number;
  }>;
  msetCalls: Array<Record<string, string>>;
} {
  const pendingScanResponses = [...scanResponses];
  const scanCalls: Array<{ cursor: string; pattern: string; count: number }> =
    [];
  const msetCalls: Array<Record<string, string>> = [];

  return {
    scanCalls,
    msetCalls,
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

void test("reconcile rewrites Redis total and available keys from DB inventory and active reservations", async () => {
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
  const redis = createRedisMock([
    ["0", [ticketRedisKeys(eventSnapshots[0].eventId).reservation("order-1")]],
    [
      "9",
      [
        ticketRedisKeys(eventSnapshots[1].eventId).reservation("order-2"),
        ticketRedisKeys(eventSnapshots[1].eventId).reservation("order-3"),
      ],
    ],
    ["0", [ticketRedisKeys(eventSnapshots[1].eventId).reservation("order-4")]],
  ]);

  await reconcileTicketAvailability({
    getEventInventorySnapshots: async () => eventSnapshots,
    redis,
    scanCount: 50,
  });

  assert.deepEqual(redis.msetCalls, [
    {
      [ticketRedisKeys(eventSnapshots[0].eventId).total]: "100",
      [ticketRedisKeys(eventSnapshots[0].eventId).available]: "54",
    },
    {
      [ticketRedisKeys(eventSnapshots[1].eventId).total]: "20",
      [ticketRedisKeys(eventSnapshots[1].eventId).available]: "0",
    },
  ]);
});
