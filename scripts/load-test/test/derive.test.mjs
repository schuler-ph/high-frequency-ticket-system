import { test } from "node:test";
import assert from "node:assert/strict";

import {
  counterDelta,
  droppedShare,
  histogramMean,
  histogramSaturation,
  quantileFromBuckets,
  drift,
  capacityDelta,
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
    // 10 free + 90 sold + 0 held == 100 seats.
    capacity: 100,
    redisAvailable: 10,
    activeReservations: 0,
  });
  assert.ok(inv.every((i) => i.ok === true));
});

// Phase 4.10/4.12: die Ablauf-Checks haengen an der Semantik (kurze Deadline,
// Denkzeit), nicht am Profilnamen. Bei langer Deadline waeren sie garantiert
// verletzt und wuerden einen korrekten Lauf faelschlich auf `fail` setzen;
// ohne Denkzeit kann kein Zahler in die Deadline laufen.
test("evaluateInvariants adds the expiry checks only when the deadline can elapse", () => {
  const base = {
    published: 100,
    completed: 90,
    failed: 10,
    dbOrders: 100,
    dbTickets: 90,
    pendingOrders: 0,
    capacity: 100,
    redisAvailable: 10,
    activeReservations: 0,
  };

  // Lange Deadline (900 s): kein Ablauf im Lauf, keine Zusatz-Checks.
  const longDeadline = evaluateInvariants({
    ...base,
    checkoutDeadlineSeconds: 900,
    thinkTimeKind: "none",
  });
  assert.equal(
    longDeadline.some(
      (i) => i.id.startsWith("sellout:") || i.id.startsWith("expiry:"),
    ),
    false,
  );

  // Kurze Deadline + Denkzeit (human-pace): alle drei Checks.
  const humanPace = evaluateInvariants({
    ...base,
    checkoutDeadlineSeconds: 120,
    thinkTimeKind: "normal",
    reaperReleases: 412,
    expiredRejections: 87,
  });
  assert.equal(
    humanPace.filter(
      (i) => i.id.startsWith("sellout:") || i.id.startsWith("expiry:"),
    ).length,
    3,
  );

  // Kurze Deadline ohne Denkzeit (full-speed): Sellout + Reaper ja, aber kein
  // Expired-Pay-Check — ohne Denkzeit zahlt niemand zu spaet, eine legitime 0
  // wuerde den Lauf sonst faelschlich kippen.
  const fullSpeed = evaluateInvariants({
    ...base,
    checkoutDeadlineSeconds: 60,
    thinkTimeKind: "none",
    reaperReleases: 412,
    expiredRejections: 0,
  });
  assert.equal(fullSpeed.filter((i) => i.id.startsWith("sellout:")).length, 2);
  assert.equal(
    fullSpeed.some((i) => i.id.startsWith("expiry:")),
    false,
  );
});

test("the expiry run fails when inventory was lost or the reaper never ran", () => {
  const base = {
    published: 100,
    completed: 90,
    failed: 10,
    dbOrders: 100,
    dbTickets: 90,
    pendingOrders: 0,
    capacity: 100,
    redisAvailable: 10,
    activeReservations: 0,
    checkoutDeadlineSeconds: 120,
    thinkTimeKind: "normal",
  };

  // 90 verkauft bei Kapazitaet 100 — genau der Verlust, den der Check
  // ausschliessen soll.
  const lost = evaluateInvariants({
    ...base,
    reaperReleases: 5,
    expiredRejections: 5,
  });
  assert.equal(lost.find((i) => i.id === "sellout: sold == totalCapacity").ok, false);

  // Nie ausgeuebter Ablauf-Pfad: der Lauf beweist die Frage nicht.
  const noReaper = evaluateInvariants({
    ...base,
    dbTickets: 100,
    redisAvailable: 0,
    reaperReleases: 0,
    expiredRejections: 0,
  });
  assert.equal(
    noReaper.find((i) => i.id.includes("reaper released")).ok,
    false,
  );
  assert.equal(
    noReaper.find((i) => i.id.includes("rejected as expired")).ok,
    false,
  );

  // Fehlende Messung ist unbewertbar, nicht bestanden.
  const unmeasured = evaluateInvariants({
    ...base,
    dbTickets: 100,
    redisAvailable: 0,
    reaperReleases: null,
    expiredRejections: null,
  });
  assert.equal(
    unmeasured.find((i) => i.id.includes("reaper released")).ok,
    null,
  );
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
    // The 12 abandoned reservations were released, so their seats are free again.
    capacity: 100,
    redisAvailable: 12,
    activeReservations: 0,
  });
  assert.ok(
    inv.every((i) => i.ok === true),
    "a correct run with 12% abandonment must not fail any invariant",
  );
});

test("capacityDelta is zero when every seat is accounted for exactly once", () => {
  assert.equal(
    capacityDelta({
      redisAvailable: 100,
      dbTickets: 850,
      activeReservations: 50,
      capacity: 1000,
    }),
    0,
  );
  // Positive = more claims than seats (oversell), negative = seats lost.
  assert.equal(
    capacityDelta({
      redisAvailable: 0,
      dbTickets: 956_750,
      activeReservations: 43_374,
      capacity: 1_000_000,
    }),
    124,
  );
});

// Regression for the state that motivated ADR-031: run
// `2026-07-27T14-18-37-924Z-b776eb5` finished with 124 claims over capacity
// because the writing reconcile released reservations that were still held. The
// old invariant set could not see it — `dbTickets == completed` and
// `pendingOrders == 0` both hold in that state, so the run was reported as
// functionally correct.
test("the capacity invariant fails on the reproduced +124 oversell state", () => {
  const facts = {
    published: 956_750,
    completed: 956_750,
    failed: 0,
    dbOrders: 956_750,
    dbTickets: 956_750,
    pendingOrders: 0,
    capacity: 1_000_000,
    redisAvailable: 0,
    activeReservations: 43_374,
  };
  const inv = evaluateInvariants(facts);
  const capacityCheck = inv.find((i) => i.id.startsWith("available +"));

  assert.equal(capacityCheck.ok, false);
  assert.equal(capacityCheck.expected, 1_000_000);
  assert.equal(capacityCheck.actual, 1_000_124);
  // Every flow invariant still holds — this is exactly why the run looked fine.
  assert.ok(
    inv.filter((i) => i !== capacityCheck).every((i) => i.ok === true),
    "the flow invariants must be blind to the oversell; only capacity catches it",
  );
});

test("the capacity invariant is unevaluable without the Redis operands", () => {
  const inv = evaluateInvariants({
    published: 10,
    completed: 10,
    failed: 0,
    dbOrders: 10,
    dbTickets: 10,
    pendingOrders: 0,
  });
  const capacityCheck = inv.find((i) => i.id.startsWith("available +"));
  assert.equal(capacityCheck.ok, null);
});
