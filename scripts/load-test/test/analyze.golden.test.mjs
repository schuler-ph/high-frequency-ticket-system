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

// `--summary-export` carried only the transport_errors aggregate until the
// 4.12 sub-metric thresholds; a pre-4.12 artifact (metric never exported) must
// stay distinguishable from a run that measured an actual zero.
test("phases without transport_errors report total null, not zero", () => {
  const derived = deriveReport({
    manifest: { runId: "no-transport" },
    phaseA: { metrics: { iterations: { count: 10 }, dropped_iterations: {} } },
    policy,
  });
  assert.equal(derived.offeredLoad.phases[0].transportErrors.total, null);
  assert.deepEqual(
    derived.offeredLoad.phases[0].transportErrors.byEndpoint,
    {},
  );
});

test("endpoint sub-metrics are extracted; other braced keys are ignored", () => {
  const derived = deriveReport({
    manifest: { runId: "transport" },
    phaseA: {
      metrics: {
        iterations: { count: 10 },
        dropped_iterations: {},
        transport_errors: { count: 7 },
        "transport_errors{endpoint:buy}": { count: 5 },
        "transport_errors{endpoint:pay}": { count: 2 },
        // The pre-existing braced key in real exports must not leak into the
        // endpoint breakdown.
        "http_req_duration{expected_response:true}": { avg: 1 },
      },
    },
    policy,
  });
  assert.deepEqual(derived.offeredLoad.phases[0].transportErrors, {
    total: 7,
    byEndpoint: { buy: 5, pay: 2 },
  });
});

test("the report renders no transport line for a pre-4.12 phase", () => {
  const derived = deriveReport({
    manifest: { runId: "no-transport-render" },
    phaseA: { metrics: { iterations: { count: 10 }, dropped_iterations: {} } },
    policy,
  });
  assert.ok(!renderReport(derived).includes("Transport errors"));
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
      postgres: { orders: 10, tickets: 10, pendingOrders: 0, capacity: 10 },
      redis: { available: 0, activeReservations: 0 },
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
      postgres: {
        orders: 1000,
        tickets: 1000,
        pendingOrders: 0,
        capacity: 1000,
      },
      redis: { available: 0, activeReservations: 0 },
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

// Regression for the misleading measurement configuration in Baseline B
// (report §2): the manifest carries the ORCHESTRATOR's env, which reported
// NODE_ENV=test while both services actually ran under `start:loadtest` with
// NODE_ENV=production. The services now publish their effective config.
test("effective service config is read from the services, not the orchestrator", () => {
  const derived = deriveReport({
    manifest: { runId: "cfg", configuration: { NODE_ENV: "test" } },
    metricsBefore: {
      api: 'service_config_info{service="api",node_env="production",log_level="warn"} 1\n',
      worker:
        'service_config_info{service="worker",node_env="production",database_pool_max="50"} 1\n',
    },
    metricsAfter: { api: "", worker: "" },
    policy,
  });

  // The harness env is preserved verbatim (it shapes the load)...
  assert.equal(derived.configuration.NODE_ENV, "test");
  // ...but the services report what they actually ran with.
  assert.equal(derived.serviceConfig.api.node_env, "production");
  assert.equal(derived.serviceConfig.api.log_level, "warn");
  assert.equal(derived.serviceConfig.worker.database_pool_max, "50");
  // The `service` label is the selector, not part of the config itself.
  assert.equal(derived.serviceConfig.api.service, undefined);
});

test("service config is null when a service does not publish it", () => {
  const derived = deriveReport({
    manifest: { runId: "cfg-absent" },
    metricsBefore: { api: "orders_accepted_total 0\n", worker: "" },
    metricsAfter: { api: "", worker: "" },
    policy,
  });
  assert.equal(derived.serviceConfig.api, null);
  assert.equal(derived.serviceConfig.worker, null);
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
      postgres: { orders: 5, tickets: 5, pendingOrders: 0, capacity: 5 },
      redis: { available: 0, activeReservations: 0 },
    },
    drain: { status: "complete" },
    policy,
  });
  assert.equal(derived.counters.ordersAccepted.value, 5);
  assert.equal(derived.validity.system.verdict, "pass");
});

// End-to-end counterpart to the derive-level regression: a run that ends with
// more claims than seats must not be reported as a functionally successful run,
// even though every flow invariant holds and the drain completed (ADR-031).
test("a run ending with claims over capacity is system=fail, not pass", () => {
  const derived = deriveReport({
    manifest: { runId: "oversell-124" },
    phaseA: {
      metrics: { iterations: { count: 956_750 }, dropped_iterations: {} },
    },
    metricsBefore: {
      api: "orders_accepted_total 0\npayments_confirmed_total 0\n",
      worker: "orders_completed_total 0\n",
    },
    metricsAfter: {
      api: "orders_accepted_total 1000124\npayments_confirmed_total 956750\n",
      worker: "orders_completed_total 956750\n",
    },
    stateAfter: {
      postgres: {
        capacity: 1_000_000,
        soldCount: 956_750,
        orders: 956_750,
        tickets: 956_750,
        pendingOrders: 0,
      },
      redis: { available: 0, activeReservations: 43_374 },
    },
    drain: { status: "complete" },
    policy,
  });

  assert.equal(derived.inventory.capacityDelta, 124);
  assert.equal(derived.validity.system.verdict, "fail");
  assert.ok(
    derived.validity.system.reasons.some((r) => r.includes("totalCapacity")),
    `expected the capacity invariant in the reasons: ${derived.validity.system.reasons.join("; ")}`,
  );
  assert.ok(
    derived.recommendations.some((r) => r.id === "invariant-failed"),
    "a violated invariant after a completed drain must raise the rule",
  );
});
