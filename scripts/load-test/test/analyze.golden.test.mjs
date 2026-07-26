import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeRunDir } from "../analyze-run.mjs";
import { deriveReport } from "../lib/analyze.mjs";
import { renderReport } from "../lib/render-markdown.mjs";
import { loadPolicy } from "../lib/config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = join(HERE, "fixtures", "baseline-a");
const GOLDEN_DIR = join(HERE, "golden");

const policy = loadPolicy();

test("derived.json matches the approved Baseline-A golden", () => {
  const derived = analyzeRunDir(RUN_DIR, policy);
  const golden = JSON.parse(
    readFileSync(join(GOLDEN_DIR, "baseline-a.derived.json"), "utf8"),
  );
  assert.deepEqual(derived, golden);
});

test("report.md matches the approved Baseline-A golden", () => {
  const derived = analyzeRunDir(RUN_DIR, policy);
  const markdown = renderReport(derived);
  const golden = readFileSync(join(GOLDEN_DIR, "baseline-a.report.md"), "utf8");
  assert.equal(markdown, golden);
});

test("analysis reproduces the Baseline-A story: invalid capacity, correct system", () => {
  const derived = analyzeRunDir(RUN_DIR, policy);
  assert.equal(derived.validity.benchmark.verdict, "invalid");
  assert.equal(derived.validity.system.verdict, "pass");
  // Upper E2E quantiles are censored at the largest finite bucket, not measured.
  assert.equal(derived.e2eLatency.quantiles.p95.censored, true);
});

test("analysis is idempotent (byte-identical Markdown across runs)", () => {
  const first = renderReport(analyzeRunDir(RUN_DIR, policy));
  const second = renderReport(analyzeRunDir(RUN_DIR, policy));
  assert.equal(first, second);
});

// Regression for the Baseline-B auto-invalidation (report §4.2): prom-client
// only exposes a LABELLED counter after its first increment, so a clean boot has
// no `orders_failed_total` line at all. Treating that as a missing baseline made
// `benchmark=invalid` unavoidable regardless of load-generator quality.
test("a counter absent from a captured snapshot counts as zero, not unknown", () => {
  const derived = deriveReport({
    manifest: { runId: "absence" },
    phaseA: { metrics: { iterations: { count: 10 }, dropped_iterations: {} } },
    // Neither snapshot mentions orders_failed_total / publish_rollbacks_total.
    metricsBefore: {
      api: "orders_accepted_total 0\npayments_confirmed_total 0\n",
      worker: "orders_completed_total 0\n",
    },
    metricsAfter: {
      api: "orders_accepted_total 10\npayments_confirmed_total 10\n",
      worker: "orders_completed_total 10\n",
    },
    stateAfter: {
      postgres: { orders: 10, tickets: 10, pendingOrders: 0 },
      redis: {},
    },
    drain: { status: "complete" },
    policy,
  });

  assert.equal(derived.counters.ordersFailed.value, 0);
  assert.equal(derived.counters.ordersFailed.hasBaseline, true);
  assert.equal(derived.counters.publishRollbacks.value, 0);
  // ...so the benchmark is no longer invalidated for missing baselines.
  assert.ok(
    !derived.validity.benchmark.reasons.some((r) => r.includes("baseline")),
    `unexpected baseline complaint: ${derived.validity.benchmark.reasons.join("; ")}`,
  );
  assert.equal(derived.validity.system.verdict, "pass");
});

// An empty snapshot means the scrape never produced data — that must stay
// `null` (unknown), otherwise an unreachable target would masquerade as "zero
// activity" and every invariant would trivially pass.
test("an empty snapshot leaves counters unknown rather than zero", () => {
  const derived = deriveReport({
    manifest: { runId: "no-scrape" },
    metricsBefore: { api: "", worker: "" },
    metricsAfter: { api: "", worker: "" },
    policy,
  });
  assert.equal(derived.counters.ordersCompleted.value, null);
  assert.equal(derived.counters.ordersCompleted.hasBaseline, false);
});

// Baseline A predates the Reserve/Pay split: it published inside `/buy` and
// never exposed payments_confirmed_total. There the reserve count IS the publish
// count, so the invariant must fall back to it instead of reading the
// absence-derived 0 and declaring 1000 completions unaccounted for.
test("pre-ADR-028 runs fall back to the reserve count as published", () => {
  const derived = deriveReport({
    manifest: { runId: "pre-split" },
    metricsBefore: {
      api: "orders_accepted_total 0\n",
      worker: "orders_completed_total 0\n",
    },
    metricsAfter: {
      api: "orders_accepted_total 1000\n",
      worker: "orders_completed_total 1000\n",
    },
    stateAfter: {
      postgres: { orders: 1000, tickets: 1000, pendingOrders: 0 },
      redis: {},
    },
    drain: { status: "complete" },
    policy,
  });
  const published = derived.invariants.find((i) =>
    i.id.startsWith("published"),
  );
  assert.equal(published.expected, 1000);
  assert.equal(published.ok, true);
});

test("deriveReport is pure over in-memory fixtures (no run dir needed)", () => {
  const derived = deriveReport({
    manifest: { runId: "unit" },
    metricsAfter: {
      api: "orders_accepted_total 5\n",
      worker: "orders_completed_total 5\norders_failed_total 0\n",
    },
    metricsBefore: {
      api: "orders_accepted_total 0\n",
      worker: "orders_completed_total 0\norders_failed_total 0\n",
    },
    stateAfter: {
      postgres: { orders: 5, tickets: 5, pendingOrders: 0 },
      redis: {},
    },
    drain: { status: "complete" },
    policy,
  });
  assert.equal(derived.counters.ordersAccepted.value, 5);
  assert.equal(derived.validity.system.verdict, "pass");
});
