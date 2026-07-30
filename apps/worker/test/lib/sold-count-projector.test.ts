import * as assert from "node:assert";
import { test } from "node:test";
import type { EventInventorySnapshot } from "@repo/db";
import { projectSoldCounts } from "../../src/lib/sold-count-projector.ts";

const SNAPSHOTS: EventInventorySnapshot[] = [
  {
    eventId: "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b",
    totalCapacity: 1_000_000,
    soldCount: 956_750,
  },
];

void test("the projector writes back exactly the shared snapshot", async () => {
  const persistCalls: EventInventorySnapshot[][] = [];

  await projectSoldCounts({
    snapshots: SNAPSHOTS,
    persistSoldCounts: async (received) => {
      persistCalls.push([...received]);
    },
  });

  // Exactly one write-back of the cycle's single aggregation — the old
  // reconcile needed a second COUNT to get its authoritative numbers (ADR-031).
  assert.deepEqual(persistCalls, [SNAPSHOTS]);
});

void test("a failing projection surfaces as an error instead of being swallowed", async () => {
  // `events.sold_count` is a read model: a failed projection must be visible
  // (metric + log) but must not be able to affect availability. There is no
  // Redis dependency in the projector's dep type, so a failure here provably
  // cannot leave the inventory in a different state.
  await assert.rejects(
    projectSoldCounts({
      snapshots: SNAPSHOTS,
      persistSoldCounts: async () => {
        throw new Error("write-back failed");
      },
    }),
    /write-back failed/,
  );
});
