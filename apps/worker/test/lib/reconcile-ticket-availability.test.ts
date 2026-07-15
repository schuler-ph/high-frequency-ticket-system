import * as assert from "node:assert";
import { test } from "node:test";
import { ticketRedisKeys } from "@repo/types/redis-keys";
import {
  calculateAvailableTickets,
  countActiveReservations,
  countStaleReservations,
  reconcileTicketAvailability,
  type EventInventorySnapshot,
  type ReconcileRedisClient,
} from "../../src/lib/reconcile-ticket-availability.ts";

type RedisMock = ReconcileRedisClient & {
  zcardCalls: string[];
  zcountCalls: Array<{
    key: string;
    min: number | string;
    max: number | string;
  }>;
  msetCalls: Array<Record<string, string>>;
  incrbyCalls: Array<{ key: string; increment: number }>;
  getCalls: string[];
};

function createRedisMock(config: {
  zcard?: Record<string, number>;
  zcount?: Record<string, number>;
  get?: Record<string, string | null>;
}): RedisMock {
  const zcardValues = config.zcard ?? {};
  const zcountValues = config.zcount ?? {};
  const getValues = config.get ?? {};

  const zcardCalls: string[] = [];
  const zcountCalls: Array<{
    key: string;
    min: number | string;
    max: number | string;
  }> = [];
  const msetCalls: Array<Record<string, string>> = [];
  const incrbyCalls: Array<{ key: string; increment: number }> = [];
  const getCalls: string[] = [];

  return {
    zcardCalls,
    zcountCalls,
    msetCalls,
    incrbyCalls,
    getCalls,
    async get(key) {
      getCalls.push(key);
      return getValues[key] ?? null;
    },
    async zcard(key) {
      zcardCalls.push(key);
      return zcardValues[key] ?? 0;
    },
    async zcount(key, min, max) {
      zcountCalls.push({ key, min, max });
      return zcountValues[key] ?? 0;
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

void test("countActiveReservations counts the ledger ZSet cardinality in one call", async () => {
  const eventId = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
  const keys = ticketRedisKeys(eventId);
  const redis = createRedisMock({ zcard: { [keys.reservations]: 3 } });

  const activeReservations = await countActiveReservations(redis, eventId);

  assert.equal(activeReservations, 3);
  assert.deepEqual(redis.zcardCalls, [keys.reservations]);
});

void test("countStaleReservations counts ledger entries older than the threshold", async () => {
  const eventId = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
  const keys = ticketRedisKeys(eventId);
  const redis = createRedisMock({ zcount: { [keys.reservations]: 2 } });

  const stale = await countStaleReservations(redis, eventId, 1_000);

  assert.equal(stale, 2);
  assert.deepEqual(redis.zcountCalls, [
    { key: keys.reservations, min: 0, max: 1_000 },
  ]);
});

void test("reconcile initializes total and available absolutely when the available key is missing", async () => {
  const eventId = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
  const keys = ticketRedisKeys(eventId);
  const redis = createRedisMock({ zcard: { [keys.reservations]: 1 } });

  await reconcileTicketAvailability({
    getEventInventorySnapshots: async () => [
      { eventId, totalCapacity: 100, soldCount: 45 },
    ],
    redis,
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
  const redis = createRedisMock({
    zcard: {
      // Event 1: eine aktive Reservation → computed = 100 - 45 - 1 = 54
      [firstKeys.reservations]: 1,
      // Event 2: drei aktive Reservations → computed = 20 - 18 - 3 = -1 → 0
      [secondKeys.reservations]: 3,
    },
    get: {
      // Redis zaehlt 60, korrekt waeren 54 → Drift +6 → INCRBY -6
      [firstKeys.available]: "60",
      // Redis zaehlt -2 (nach Ueberverkaufs-Fenster), korrekt 0 → Drift -2 → INCRBY +2
      [secondKeys.available]: "-2",
    },
  });

  await reconcileTicketAvailability({
    getEventInventorySnapshots: async () => eventSnapshots,
    redis,
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
  const redis = createRedisMock({
    zcard: { [keys.reservations]: 1 },
    get: { [keys.available]: "54" },
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

void test("reconcile does NOT release inventory for reservations older than the stale threshold (ADR-026)", async () => {
  // Regression fuer die Baseline-A -314k-Drift: Bei ~2.000 Accepts/s vs.
  // ~500/s Worker-Drain leben Reservierungen laenger als jede fruehere TTL.
  // Der Ledger-Eintrag zaehlt weiter als aktiver Anspruch (ZCARD), auch wenn
  // er als stale gilt — Reconcile darf `available` NICHT wieder hochbuchen,
  // sonst wird ueberverkauft.
  const eventId = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
  const keys = ticketRedisKeys(eventId);

  // 300.000 akzeptierte, noch nicht finalisierte Orders, alle "alt".
  const activeClaims = 300_000;
  const redis = createRedisMock({
    zcard: { [keys.reservations]: activeClaims },
    zcount: { [keys.reservations]: activeClaims }, // alle stale
    // Redis `available` wurde pro Accept dekrementiert: 1.000.000 - 300.000.
    get: { [keys.available]: String(1_000_000 - activeClaims) },
  });

  const ledgerMeasurements: Array<{ active: number; stale: number }> = [];

  await reconcileTicketAvailability({
    getEventInventorySnapshots: async () => [
      { eventId, totalCapacity: 1_000_000, soldCount: 0 },
    ],
    redis,
    // Fixe Uhr; alle Eintraege liegen vor (now - threshold).
    now: () => 10_000_000_000,
    staleReservationThresholdMs: 900_000,
    onReservationLedgerMeasured: (_eventId, active, stale) => {
      ledgerMeasurements.push({ active, stale });
    },
  });

  // computed = 1.000.000 - 0 - 300.000 = 700.000 == redisAvailable → keine
  // Korrektur, kein Inventar wird faelschlich wieder verfuegbar gemacht.
  assert.deepEqual(redis.incrbyCalls, []);
  assert.deepEqual(ledgerMeasurements, [
    { active: activeClaims, stale: activeClaims },
  ]);
});

void test("reconcile reports active and stale ledger measurements per event", async () => {
  const eventId = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
  const keys = ticketRedisKeys(eventId);
  const redis = createRedisMock({
    zcard: { [keys.reservations]: 5 },
    zcount: { [keys.reservations]: 2 },
    get: { [keys.available]: "95" },
  });

  const measurements: Array<{
    eventId: string;
    active: number;
    stale: number;
  }> = [];

  await reconcileTicketAvailability({
    getEventInventorySnapshots: async () => [
      { eventId, totalCapacity: 100, soldCount: 0 },
    ],
    redis,
    onReservationLedgerMeasured: (eid, active, stale) => {
      measurements.push({ eventId: eid, active, stale });
    },
  });

  assert.deepEqual(measurements, [{ eventId, active: 5, stale: 2 }]);
});

void test("reconcile calls onEventReconciled with Redis and computed available counts", async () => {
  const eventId = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
  const keys = ticketRedisKeys(eventId);
  const redis = createRedisMock({
    zcard: { [keys.reservations]: 1 },
    get: { [keys.available]: "60" },
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
