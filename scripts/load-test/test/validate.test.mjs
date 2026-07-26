import { test } from "node:test";
import assert from "node:assert/strict";

import { benchmarkValidity, systemResult } from "../lib/validate.mjs";

const POLICY = {
  maxDroppedIterationRateForValidRun: 0.001,
  maxDroppedIterationRateForDegradedRun: 0.05,
  maxScrapeGapSeconds: 15,
  requireApiAndWorkerUp: true,
  requireCounterBaselines: true,
};

const HEALTHY = {
  droppedShare: 0,
  scrapeGapSeconds: 5,
  apiUp: true,
  workerUp: true,
  hasCounterBaselines: true,
  countersReset: false,
};

test("benchmarkValidity is valid for a clean run", () => {
  const r = benchmarkValidity(HEALTHY, POLICY);
  assert.equal(r.verdict, "valid");
});

test("benchmarkValidity invalidates on generator saturation (Baseline A)", () => {
  const r = benchmarkValidity({ ...HEALTHY, droppedShare: 0.6824 }, POLICY);
  assert.equal(r.verdict, "invalid");
  assert.match(r.reasons.join(" "), /saturation/i);
});

test("benchmarkValidity degrades for a small dropped rate over the valid limit", () => {
  const r = benchmarkValidity({ ...HEALTHY, droppedShare: 0.01 }, POLICY);
  assert.equal(r.verdict, "degraded");
});

test("benchmarkValidity invalidates on counter reset", () => {
  const r = benchmarkValidity({ ...HEALTHY, countersReset: true }, POLICY);
  assert.equal(r.verdict, "invalid");
});

test("benchmarkValidity invalidates when a scrape target is down", () => {
  const r = benchmarkValidity({ ...HEALTHY, workerUp: false }, POLICY);
  assert.equal(r.verdict, "invalid");
});

test("benchmarkValidity degrades on an excessive scrape gap", () => {
  const r = benchmarkValidity({ ...HEALTHY, scrapeGapSeconds: 40 }, POLICY);
  assert.equal(r.verdict, "degraded");
});

const SYS_POLICY = { requireDrainForCorrectnessVerdict: true };

test("systemResult passes when all invariants hold and drain completed", () => {
  const r = systemResult(
    {
      invariants: [
        { id: "a", ok: true },
        { id: "b", ok: true },
      ],
      drainStatus: "complete",
    },
    SYS_POLICY,
  );
  assert.equal(r.verdict, "pass");
});

test("systemResult fails on a violated invariant regardless of drain", () => {
  const r = systemResult(
    { invariants: [{ id: "a", ok: false }], drainStatus: "timeout" },
    SYS_POLICY,
  );
  assert.equal(r.verdict, "fail");
});

test("systemResult is inconclusive when drain did not complete", () => {
  const r = systemResult(
    { invariants: [{ id: "a", ok: true }], drainStatus: "timeout" },
    SYS_POLICY,
  );
  assert.equal(r.verdict, "inconclusive");
});

test("systemResult is inconclusive when an invariant is unevaluable", () => {
  const r = systemResult(
    {
      invariants: [
        { id: "a", ok: true },
        { id: "b", ok: null },
      ],
      drainStatus: "complete",
    },
    SYS_POLICY,
  );
  assert.equal(r.verdict, "inconclusive");
});
