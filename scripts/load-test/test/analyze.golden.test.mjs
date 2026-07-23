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
