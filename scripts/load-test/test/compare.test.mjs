import { test } from "node:test";
import assert from "node:assert/strict";

import { compareRuns, renderComparison } from "../lib/compare.mjs";

const makeRun = (overrides = {}) => ({
  runId: "r",
  git: { dirty: false },
  capacity: { totalCapacity: 1000 },
  configuration: { LOAD_PROFILE: "capacity" },
  offeredLoad: { droppedShare: 0 },
  e2eLatency: { mean: 0.01 },
  counters: { ordersCompleted: { value: 1000 } },
  drift: { final: 0 },
  validity: { benchmark: { verdict: "valid" }, system: { verdict: "pass" } },
  ...overrides,
});

test("compatible runs produce a positive comparison + deltas", () => {
  const baseline = makeRun({ e2eLatency: { mean: 0.02 } });
  const candidate = makeRun({ e2eLatency: { mean: 0.01 } });
  const c = compareRuns(baseline, candidate);
  assert.equal(c.compatible, true);
  assert.equal(c.deltas.e2eMean.absolute, -0.01);
  assert.equal(c.deltas.e2eMean.percent, -0.5);
});

test("mismatched capacity is rejected", () => {
  const c = compareRuns(
    makeRun(),
    makeRun({ capacity: { totalCapacity: 2000 } }),
  );
  assert.equal(c.compatible, false);
  assert.match(c.incompatibilities.join(" "), /capacity/i);
});

test("mismatched load profile is rejected", () => {
  const c = compareRuns(
    makeRun(),
    makeRun({ configuration: { LOAD_PROFILE: "browse-and-buy-human-pace" } }),
  );
  assert.equal(c.compatible, false);
  assert.match(c.incompatibilities.join(" "), /profile/i);
});

test("dirty candidate git state is rejected", () => {
  const c = compareRuns(makeRun(), makeRun({ git: { dirty: true } }));
  assert.equal(c.compatible, false);
  assert.match(c.incompatibilities.join(" "), /dirty/i);
});

// Phase 4.13 densified the 1–5 s range of the E2E histogram. Quantiles are
// interpolated within buckets, so a pre-change baseline must not be compared
// silently against a post-change candidate.
test("differing E2E bucket ladders are flagged, identical or absent ones are not", () => {
  const before = [0.001, 0.5, 1, 2.5, 5, 10];
  const after = [0.001, 0.5, 1, 1.5, 2, 2.5, 3, 5, 10];
  const differ = compareRuns(
    makeRun({ e2eLatency: { mean: 0.01, bucketBoundaries: before } }),
    makeRun({ e2eLatency: { mean: 0.01, bucketBoundaries: after } }),
  );
  assert.equal(differ.compatible, false);
  assert.match(differ.incompatibilities.join(" "), /bucket ladders differ/i);

  const same = compareRuns(
    makeRun({ e2eLatency: { mean: 0.01, bucketBoundaries: after } }),
    makeRun({ e2eLatency: { mean: 0.01, bucketBoundaries: after } }),
  );
  assert.equal(same.compatible, true);

  // Pre-schema-4 artifacts carry no ladder: nothing to compare, no complaint.
  assert.equal(compareRuns(makeRun(), makeRun()).compatible, true);
});

test("invalid candidate benchmark is rejected for a capacity claim", () => {
  const c = compareRuns(
    makeRun(),
    makeRun({
      validity: {
        benchmark: { verdict: "invalid" },
        system: { verdict: "pass" },
      },
    }),
  );
  assert.equal(c.compatible, false);
  assert.match(c.incompatibilities.join(" "), /invalid/i);
});

test("percent delta is null when the baseline is zero (no divide-by-zero)", () => {
  const c = compareRuns(
    makeRun({ offeredLoad: { droppedShare: 0 } }),
    makeRun({ offeredLoad: { droppedShare: 0.1 } }),
  );
  assert.equal(c.deltas.droppedShare.absolute, 0.1);
  assert.equal(c.deltas.droppedShare.percent, null);
});

test("renderComparison is deterministic and lists incompatibilities", () => {
  const c = compareRuns(
    makeRun(),
    makeRun({ capacity: { totalCapacity: 2000 } }),
  );
  const md = renderComparison(c, { baselineId: "a", candidateId: "b" });
  assert.equal(md, renderComparison(c, { baselineId: "a", candidateId: "b" }));
  assert.match(md, /Incompatibilities/);
});
