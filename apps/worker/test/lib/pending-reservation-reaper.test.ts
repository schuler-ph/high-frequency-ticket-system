import * as assert from "node:assert";
import { test } from "node:test";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import {
  reapPendingReservations,
  type EventReaperResult,
} from "../../src/lib/pending-reservation-reaper.ts";

const EVENT_ID = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
const RELEASED_ID = "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23";
const PUBLISHING_ID = "efdd1276-694c-49e6-bf5b-3ff6c8cfc0e3";

void test("reaper processes only due candidates and reports every outcome", async () => {
  const calls: Array<{
    ledger: string;
    available: string;
    orderKey: string;
    orderId: string;
    nowMs: number;
  }> = [];
  const observed: EventReaperResult[] = [];

  const results = await reapPendingReservations({
    snapshots: [{ eventId: EVENT_ID, totalCapacity: 100, soldCount: 20 }],
    nowMs: 10_000,
    batchSize: 100,
    redis: {
      async zcount() {
        return 2;
      },
      async zrangebyscore() {
        return [RELEASED_ID, "9000", PUBLISHING_ID, "8000"];
      },
      async reapPendingReservation(
        ledger,
        available,
        orderKey,
        orderId,
        nowMs,
      ) {
        calls.push({ ledger, available, orderKey, orderId, nowMs });
        return orderId === RELEASED_ID ? 1 : 4;
      },
    },
    onEventReaped: (result) => observed.push(result),
  });

  assert.equal(results.length, 1);
  const result = results[0];
  assert.ok(result);
  assert.equal(result.candidates, 2);
  assert.equal(result.processed, 2);
  assert.equal(result.released, 1);
  assert.equal(result.skipped.publishing, 1);
  assert.equal(result.errors, 0);
  assert.equal(result.oldestReleasedAgeSeconds, 1);
  assert.deepEqual(observed, results);

  const keys = ticketRedisKeys(EVENT_ID);
  assert.deepEqual(calls, [
    {
      ledger: keys.reservations,
      available: keys.available,
      orderKey: orderRedisKeys.entry(RELEASED_ID),
      orderId: RELEASED_ID,
      nowMs: 10_000,
    },
    {
      ledger: keys.reservations,
      available: keys.available,
      orderKey: orderRedisKeys.entry(PUBLISHING_ID),
      orderId: PUBLISHING_ID,
      nowMs: 10_000,
    },
  ]);
});

void test("one candidate error does not block later releases", async () => {
  const errors: string[] = [];
  let calls = 0;

  const [result] = await reapPendingReservations({
    snapshots: [{ eventId: EVENT_ID, totalCapacity: 2, soldCount: 0 }],
    nowMs: 10_000,
    batchSize: 100,
    redis: {
      async zcount() {
        return 2;
      },
      async zrangebyscore() {
        return [RELEASED_ID, "9000", PUBLISHING_ID, "9000"];
      },
      async reapPendingReservation() {
        calls += 1;
        if (calls === 1) throw new Error("redis timeout");
        return 1;
      },
    },
    onError: (_eventId, orderId, error) => {
      errors.push(`${orderId}:${String(error)}`);
    },
  });

  assert.ok(result);
  assert.equal(result.errors, 1);
  assert.equal(result.released, 1);
  assert.equal(calls, 2);
  assert.match(errors[0] ?? "", /redis timeout/);
});

void test("empty event ledger is a successful no-op", async () => {
  const [result] = await reapPendingReservations({
    snapshots: [{ eventId: EVENT_ID, totalCapacity: 10, soldCount: 10 }],
    nowMs: 10_000,
    batchSize: 100,
    redis: {
      async zcount() {
        return 0;
      },
      async zrangebyscore() {
        return [];
      },
      async reapPendingReservation() {
        throw new Error("must not be called");
      },
    },
  });

  assert.ok(result);
  assert.equal(result.candidates, 0);
  assert.equal(result.processed, 0);
  assert.equal(result.released, 0);
  assert.equal(result.errors, 0);
});
