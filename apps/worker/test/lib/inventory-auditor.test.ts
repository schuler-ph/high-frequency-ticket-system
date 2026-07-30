import * as assert from "node:assert";
import { test } from "node:test";
import { ticketRedisKeys } from "@repo/types/redis-keys";
import {
  auditTicketInventory,
  countActiveReservations,
  countStaleReservations,
  InventoryAuditError,
  type EventInventoryAudit,
  type EventInventorySnapshot,
} from "../../src/lib/inventory-auditor.ts";

const EVENT_ID = "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b";
const OTHER_EVENT_ID = "04c1ea10-6d1b-47c2-bd64-5e2cfaec4f64";

/**
 * Redis double with a mutable store PLUS the write commands the auditor must
 * never reach for. They are not part of `InventoryAuditRedisClient`, so the
 * compiler already forbids them — recording them here proves the runtime path
 * agrees, and gives the "an audit never changes the inventory" test something
 * concrete to assert.
 */
function createRedisMock(config: {
  strings?: Record<string, string>;
  zcard?: Record<string, number>;
  zcount?: Record<string, number>;
  onGet?: (key: string) => void;
  onZcard?: (key: string) => void;
}) {
  const strings = { ...(config.strings ?? {}) };
  const zcardValues = { ...(config.zcard ?? {}) };
  const zcountValues = { ...(config.zcount ?? {}) };
  const writes: string[] = [];

  return {
    strings,
    zcardValues,
    writes,
    async get(key: string) {
      const value = strings[key] ?? null;
      // Hook fires AFTER the read so a test can simulate concurrent traffic
      // landing between the auditor's two reads.
      config.onGet?.(key);
      return value;
    },
    async zcard(key: string) {
      const value = zcardValues[key] ?? 0;
      config.onZcard?.(key);
      return value;
    },
    async zcount(key: string, min: number | string, max: number | string) {
      void min;
      void max;
      return zcountValues[key] ?? 0;
    },
    async set(key: string, value: string) {
      writes.push(`set ${key}=${value}`);
      strings[key] = value;
      return "OK";
    },
    async mset(values: Record<string, string>) {
      writes.push(`mset ${Object.keys(values).join(",")}`);
      Object.assign(strings, values);
      return "OK";
    },
    async incrby(key: string, increment: number) {
      writes.push(`incrby ${key} ${increment}`);
      strings[key] = String(Number(strings[key] ?? 0) + increment);
      return Number(strings[key]);
    },
  };
}

void test("audit reports the signed capacity delta per event", async () => {
  const keys = ticketRedisKeys(EVENT_ID);
  const redis = createRedisMock({
    strings: { [keys.available]: "54" },
    zcard: { [keys.reservations]: 1 },
    zcount: { [keys.reservations]: 0 },
  });

  const audited: EventInventoryAudit[] = [];
  const audits = await auditTicketInventory({
    snapshots: [{ eventId: EVENT_ID, totalCapacity: 100, soldCount: 45 }],
    redis,
    staleScoreCeiling: 0,
    onEventAudited: (audit) => audited.push(audit),
  });

  // 54 free + 45 sold + 1 held == 100 seats -> nothing unaccounted for.
  assert.deepEqual(audits, [
    {
      eventId: EVENT_ID,
      totalCapacity: 100,
      soldCount: 45,
      available: 54,
      activeReservations: 1,
      staleReservations: 0,
      capacityDelta: 0,
    },
  ]);
  assert.deepEqual(audited, audits);
});

void test("overclaim stays visible as a positive, unclamped delta", async () => {
  // The Baseline-C end state in miniature: sold + held exceeds capacity by 5.
  // The old reconcile clamped this to 0 and went blind (report §5).
  const keys = ticketRedisKeys(EVENT_ID);
  const redis = createRedisMock({
    strings: { [keys.available]: "0" },
    zcard: { [keys.reservations]: 10 },
  });

  const [audit] = await auditTicketInventory({
    snapshots: [{ eventId: EVENT_ID, totalCapacity: 100, soldCount: 95 }],
    redis,
    staleScoreCeiling: 0,
  });

  assert.equal(audit.capacityDelta, 5);
});

void test("a reservation created during the audit can never raise available", async () => {
  // The exact race that motivated ADR-031: a reserve lands between the
  // `available` read and the ledger read, so the snapshot mixes a pre-reserve
  // counter with a post-reserve ledger and the delta reads +1 although nothing
  // is wrong. The old reconcile wrote that difference back and handed the
  // still-held seat out a second time (run …-b776eb5 ended at +124).
  // Read-only means the same race can only mis-report, never mis-book.
  const keys = ticketRedisKeys(EVENT_ID);
  const redis = createRedisMock({
    strings: { [keys.available]: "54" },
    zcard: { [keys.reservations]: 1 },
    onGet: () => {
      // The concurrent reserve: atomic DECR + ZADD, both invisible to the
      // `available` read that just happened.
      redis.strings[keys.available] = "53";
      redis.zcardValues[keys.reservations] = 2;
    },
  });

  const [audit] = await auditTicketInventory({
    snapshots: [{ eventId: EVENT_ID, totalCapacity: 100, soldCount: 45 }],
    redis,
    staleScoreCeiling: 0,
  });

  assert.equal(audit.capacityDelta, 1, "the transient delta is reported...");
  assert.deepEqual(redis.writes, [], "...and nothing is written to fix it");
  assert.equal(
    redis.strings[keys.available],
    "53",
    "only the concurrent reserve changed the counter, never the audit",
  );
});

void test("a missing availability key is an audit error, never an initialization", async () => {
  const keys = ticketRedisKeys(EVENT_ID);
  const otherKeys = ticketRedisKeys(OTHER_EVENT_ID);
  const redis = createRedisMock({
    // First event has no `available` key at all (empty Redis after a restart).
    strings: { [otherKeys.available]: "7" },
    zcard: { [otherKeys.reservations]: 3 },
  });

  const audited: string[] = [];
  await assert.rejects(
    auditTicketInventory({
      snapshots: [
        { eventId: EVENT_ID, totalCapacity: 100, soldCount: 45 },
        { eventId: OTHER_EVENT_ID, totalCapacity: 20, soldCount: 10 },
      ],
      redis,
      staleScoreCeiling: 0,
      onEventAudited: (audit) => audited.push(audit.eventId),
    }),
    (error: unknown) => {
      assert.ok(error instanceof InventoryAuditError);
      assert.deepEqual(error.eventIds, [EVENT_ID]);
      return true;
    },
  );

  // The healthy event was still measured before the run failed...
  assert.deepEqual(audited, [OTHER_EVENT_ID]);
  // ...and the missing key was NOT reconstructed from PostgreSQL.
  assert.deepEqual(redis.writes, []);
  assert.equal(keys.available in redis.strings, false);
});

void test("stale reservations are counted against the caller's score ceiling", async () => {
  const keys = ticketRedisKeys(EVENT_ID);
  const zcountCalls: Array<{ key: string; max: number | string }> = [];
  const redis = createRedisMock({
    strings: { [keys.available]: "0" },
    zcard: { [keys.reservations]: 300_000 },
    zcount: { [keys.reservations]: 42 },
  });
  const originalZcount = redis.zcount.bind(redis);
  redis.zcount = async (key, min, max) => {
    zcountCalls.push({ key, max });
    return originalZcount(key, min, max);
  };

  const [audit] = await auditTicketInventory({
    snapshots: [
      { eventId: EVENT_ID, totalCapacity: 1_000_000, soldCount: 700_000 },
    ],
    redis,
    staleScoreCeiling: 9_999_100_000,
  });

  assert.equal(audit.staleReservations, 42);
  assert.deepEqual(zcountCalls, [
    { key: keys.reservations, max: 9_999_100_000 },
  ]);
  // Stale is a reaper candidate count, not a release: still 300k active claims.
  assert.equal(audit.activeReservations, 300_000);
  assert.deepEqual(redis.writes, []);
});

void test("countActiveReservations / countStaleReservations read the ledger ZSet", async () => {
  const keys = ticketRedisKeys(EVENT_ID);
  const redis = createRedisMock({
    zcard: { [keys.reservations]: 3 },
    zcount: { [keys.reservations]: 2 },
  });

  assert.equal(await countActiveReservations(redis, EVENT_ID), 3);
  assert.equal(await countStaleReservations(redis, EVENT_ID, 1_000), 2);
});

void test("an empty snapshot list audits nothing and fails nothing", async () => {
  const redis = createRedisMock({});
  const snapshots: EventInventorySnapshot[] = [];

  assert.deepEqual(
    await auditTicketInventory({ snapshots, redis, staleScoreCeiling: 0 }),
    [],
  );
  assert.deepEqual(redis.writes, []);
});
