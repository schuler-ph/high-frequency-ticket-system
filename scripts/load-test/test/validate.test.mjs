import { test } from "node:test";
import assert from "node:assert/strict";

import {
  benchmarkValidity,
  performanceVerdict,
  systemResult,
} from "../lib/validate.mjs";

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

// --- performance (ADR-036) ---

const PERF_POLICY = { gates: ["http_req_duration", "http_req_failed"] };

const gate = (metric, expression, breached, observed) => ({
  metric,
  expression,
  breached,
  observed,
});

const HELD = [
  gate("http_req_duration", "p(95)<500", false, 13.9),
  gate("http_req_failed", "rate<0.05", false, 0),
];

test("performanceVerdict passes when every gate held in every phase", () => {
  const r = performanceVerdict(
    {
      phases: [
        { name: "phase-a", thresholds: HELD },
        { name: "phase-b", thresholds: HELD },
      ],
    },
    PERF_POLICY,
  );
  assert.equal(r.verdict, "pass");
});

// Baseline E, browse-and-buy-full-speed: p95 876 ms against p(95)<500 — the
// number that never reached a verdict before.
test("performanceVerdict fails on a breached gate and names the observed value", () => {
  const r = performanceVerdict(
    {
      phases: [
        {
          name: "phase-a",
          thresholds: [
            gate("http_req_duration", "p(95)<500", true, 876.0995),
            gate("http_req_failed", "rate<0.05", false, 0),
          ],
        },
        { name: "phase-b", thresholds: HELD },
      ],
    },
    PERF_POLICY,
  );
  assert.equal(r.verdict, "fail");
  assert.equal(r.reasons.length, 1);
  assert.match(
    r.reasons[0],
    /http_req_duration p\(95\)<500 breached in phase-a/,
  );
  assert.match(r.reasons[0], /observed 876\.0995/);
});

// The export-only sub-metric selectors (`count>=0`) live in the same map as
// the real gates. They must never be able to fail — or pass — the verdict.
test("performanceVerdict ignores thresholds that are not policy gates", () => {
  const r = performanceVerdict(
    {
      phases: [
        {
          name: "phase-a",
          thresholds: [
            ...HELD,
            gate("transport_errors{endpoint:buy}", "count>=0", true, 94598),
          ],
        },
      ],
    },
    PERF_POLICY,
  );
  assert.equal(r.verdict, "pass");
});

// A summary without any thresholds (Baseline A predates them) is not a clean
// run — it is an artifact that cannot answer the question.
test("performanceVerdict is inconclusive without exported thresholds", () => {
  const r = performanceVerdict(
    { phases: [{ name: "phase-a", thresholds: null }] },
    PERF_POLICY,
  );
  assert.equal(r.verdict, "inconclusive");
  assert.match(r.reasons[0], /predates/);
});

test("performanceVerdict is inconclusive when a gate was not declared", () => {
  const r = performanceVerdict(
    {
      phases: [
        {
          name: "phase-b",
          thresholds: [gate("http_req_duration", "p(95)<500", false, 20)],
        },
      ],
    },
    PERF_POLICY,
  );
  assert.equal(r.verdict, "inconclusive");
  assert.match(r.reasons[0], /http_req_failed was not declared in phase-b/);
});

// A breach is a stronger statement than a missing gate: fail wins.
test("performanceVerdict reports fail over inconclusive", () => {
  const r = performanceVerdict(
    {
      phases: [
        {
          name: "phase-a",
          thresholds: [gate("http_req_duration", "p(95)<500", true, 809)],
        },
      ],
    },
    PERF_POLICY,
  );
  assert.equal(r.verdict, "fail");
});

test("performanceVerdict is inconclusive when the policy lists no gates", () => {
  const r = performanceVerdict(
    { phases: [{ name: "phase-a", thresholds: HELD }] },
    { gates: [] },
  );
  assert.equal(r.verdict, "inconclusive");
});
