import { test } from "node:test";
import assert from "node:assert/strict";

import {
  counterDelta,
  droppedShare,
  histogramMean,
  histogramSaturation,
  quantileFromBuckets,
  drift,
  evaluateInvariants,
} from "../lib/derive.mjs";

test("counterDelta computes a normal delta", () => {
  assert.deepEqual(counterDelta(100, 250), {
    value: 150,
    reset: false,
    hasBaseline: true,
  });
});

test("counterDelta flags a reset when after < before", () => {
  const result = counterDelta(500, 4);
  assert.equal(result.reset, true);
  assert.equal(result.value, null);
});

test("counterDelta reports missing baseline", () => {
  assert.deepEqual(counterDelta(null, 42), {
    value: null,
    reset: false,
    hasBaseline: false,
  });
});

test("droppedShare uses iterations + dropped as scheduled", () => {
  const r = droppedShare({ iterations: 800, droppedIterations: 200 });
  assert.equal(r.scheduled, 1000);
  assert.equal(r.droppedShare, 0.2);
  assert.equal(r.executedShare, 0.8);
});

test("droppedShare handles zero scheduled without dividing by zero", () => {
  assert.deepEqual(droppedShare({ iterations: 0, droppedIterations: 0 }), {
    scheduled: 0,
    executedShare: 0,
    droppedShare: 0,
  });
});

test("histogramMean = sum / count, null when no observations", () => {
  assert.equal(histogramMean({ sum: 15, count: 3 }), 5);
  assert.equal(histogramMean({ sum: 0, count: 0 }), null);
  assert.equal(histogramMean({ sum: null, count: 3 }), null);
});

test("histogramSaturation detects censored upper tail (Baseline-A shape)", () => {
  // 14117 of 420951 observations fell in the largest finite bucket <=30s.
  const buckets = [
    { le: 30, cumulativeCount: 14117 },
    { le: Number.POSITIVE_INFINITY, cumulativeCount: 420951 },
  ];
  const s = histogramSaturation(buckets);
  assert.equal(s.largestFiniteLe, 30);
  assert.equal(s.totalCount, 420951);
  assert.ok(s.fractionAboveLargestFinite > 0.95);
});

test("quantileFromBuckets censors a quantile above the largest finite bucket", () => {
  const buckets = [
    { le: 30, cumulativeCount: 14117 },
    { le: Number.POSITIVE_INFINITY, cumulativeCount: 420951 },
  ];
  const p95 = quantileFromBuckets(buckets, 0.95);
  assert.equal(p95.censored, true);
  assert.equal(p95.le, 30);
});

test("quantileFromBuckets resolves an in-range quantile without censoring", () => {
  const buckets = [
    { le: 0.001, cumulativeCount: 2 },
    { le: 0.01, cumulativeCount: 6 },
    { le: 0.1, cumulativeCount: 9 },
    { le: Number.POSITIVE_INFINITY, cumulativeCount: 12 },
  ];
  const p50 = quantileFromBuckets(buckets, 0.5); // rank 6 -> le 0.01
  assert.deepEqual(p50, { le: 0.01, censored: false });
});

test("drift follows the ADR-023 identity", () => {
  assert.equal(
    drift({
      redisAvailable: 100,
      capacity: 1000,
      soldCount: 850,
      activeReservations: 50,
    }),
    0,
  );
  assert.equal(
    drift({
      redisAvailable: 90,
      capacity: 1000,
      soldCount: 850,
      activeReservations: 50,
    }),
    -10,
  );
});

test("evaluateInvariants passes when every source converges", () => {
  const inv = evaluateInvariants({
    published: 100,
    completed: 90,
    failed: 10,
    dbOrders: 100,
    dbTickets: 90,
    pendingOrders: 0,
  });
  assert.ok(inv.every((i) => i.ok === true));
});

test("evaluateInvariants marks unevaluable checks null, not failed", () => {
  const inv = evaluateInvariants({
    published: null,
    completed: 90,
    failed: 10,
    dbOrders: 100,
    dbTickets: 90,
    pendingOrders: 0,
  });
  const publishedCheck = inv.find((i) => i.id.startsWith("published"));
  assert.equal(publishedCheck.ok, null);
});

test("evaluateInvariants fails a violated check", () => {
  const inv = evaluateInvariants({
    published: 100,
    completed: 80,
    failed: 10,
    dbOrders: 100,
    dbTickets: 80,
    pendingOrders: 0,
  });
  const publishedCheck = inv.find((i) => i.id.startsWith("published"));
  assert.equal(publishedCheck.ok, false); // 100 != 90
});

// Regression for the Baseline-B misreading (report §4.4): reservations that are
// cancelled or abandoned are never published, so holding the worker to the
// RESERVE count invents a permanent shortfall. Here 100 reserved / 88 published
// / 88 persisted is a fully drained, correct system.
test("evaluateInvariants ignores unpublished reservations (abandonment profile)", () => {
  const inv = evaluateInvariants({
    published: 88,
    completed: 88,
    failed: 0,
    dbOrders: 88,
    dbTickets: 88,
    pendingOrders: 0,
  });
  assert.ok(
    inv.every((i) => i.ok === true),
    "a correct run with 12% abandonment must not fail any invariant",
  );
});
