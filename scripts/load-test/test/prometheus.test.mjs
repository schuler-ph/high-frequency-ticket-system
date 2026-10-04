import { test } from "node:test";
import assert from "node:assert/strict";

import {
  countTargetsUp,
  instantQuery,
  readEventCounter,
  readLedgerActive,
  snapshotJob,
  targetUp,
  vectorToExposition,
  waitForFreshScrape,
} from "../lib/prometheus.mjs";
import { deriveReport } from "../lib/analyze.mjs";
import { loadPolicy } from "../lib/config.mjs";

const policy = loadPolicy();
const EVENT = "00000000-0000-4000-8000-000000000000";

const vector = (series) => ({
  status: "success",
  data: {
    resultType: "vector",
    result: series.map(([metric, value]) => ({
      metric,
      value: [1_790_000_000, String(value)],
    })),
  },
});

/**
 * A fake Prometheus HTTP API. `answer(promql)` returns the `[labels, value]`
 * series for a query; every query is recorded so tests can assert which
 * aggregation the caller asked for.
 */
const fakePrometheus = (answer) => {
  const queries = [];
  const fetchImpl = async (url) => {
    const promql = new URL(url).searchParams.get("query");
    queries.push(promql);
    return { ok: true, json: async () => vector(answer(promql)) };
  };
  return { fetchImpl, queries };
};

// --- Aggregation instead of "first series" ---

test("instantQuery reads a single aggregated value", async () => {
  const prom = fakePrometheus(() => [[{}, 42]]);
  const { value } = await instantQuery("http://p", "sum(x)", prom.fetchImpl);
  assert.equal(value, 42);
});

test("instantQuery reports no series as null, not zero", async () => {
  const prom = fakePrometheus(() => []);
  const { value } = await instantQuery("http://p", "sum(x)", prom.fetchImpl);
  assert.equal(value, null);
});

// Vorher nahm der Client stillschweigend die erste Serie: mit drei API-Pods
// stand dann ein einzelner Pod im Report, als waere er das ganze System.
test("instantQuery refuses several series instead of reading one pod", async () => {
  const prom = fakePrometheus(() => [
    [{ instance: "api-a" }, 1],
    [{ instance: "api-b" }, 0],
  ]);
  await assert.rejects(
    instantQuery("http://p", 'up{job="api"}', prom.fetchImpl),
    /2 series/,
  );
});

test("targetUp is false as soon as one pod of the job is down", async () => {
  const prom = fakePrometheus((q) => (q === 'min(up{job="api"})' ? [[{}, 0]] : []));
  assert.equal(await targetUp("http://p", "api", prom.fetchImpl), false);
  assert.deepEqual(prom.queries, ['min(up{job="api"})']);
});

test("targetUp is null when the job has no target at all", async () => {
  const prom = fakePrometheus(() => []);
  assert.equal(await targetUp("http://p", "worker", prom.fetchImpl), null);
});

test("countTargetsUp counts healthy pods and reads absence as zero", async () => {
  const three = fakePrometheus(() => [[{}, 3]]);
  assert.equal(await countTargetsUp("http://p", "api", three.fetchImpl), 3);
  assert.deepEqual(three.queries, ['count(up{job="api"} == 1)']);
  const none = fakePrometheus(() => []);
  assert.equal(await countTargetsUp("http://p", "api", none.fetchImpl), 0);
});

// Sold-out-Quelle (ADR-025) und Drain lesen ueber alle Worker-Pods: Counter
// summiert, der Ledger als Weltzustand per max.
test("event readers sum contributions and take world state once", async () => {
  const prom = fakePrometheus(() => [[{}, 7]]);
  assert.equal(
    await readEventCounter("http://p", "orders_completed_total", EVENT, prom.fetchImpl),
    7,
  );
  assert.equal(await readLedgerActive("http://p", EVENT, prom.fetchImpl), 7);
  assert.deepEqual(prom.queries, [
    `sum(orders_completed_total{job="worker", event_id="${EVENT}"})`,
    `max(reservation_ledger_active{job="worker", event_id="${EVENT}"})`,
  ]);
});

// --- Snapshots across several pods ---

test("vectorToExposition renders sorted, escaped exposition lines", () => {
  const text = vectorToExposition([
    [{ __name__: "b_total", route: 'say "hi"' }, 2],
    [{ __name__: "a_total" }, 1],
    [{ __name__: "c", le: "+Inf" }, Number.POSITIVE_INFINITY],
    [{ instance: "no-name" }, 9],
  ].map(([labels, value]) => ({ labels, value })));
  assert.equal(
    text,
    'a_total 1\nb_total{route="say \\"hi\\""} 2\nc{le="+Inf"} +Inf\n',
  );
});

const apiPods = ["api-a", "api-b", "api-c"];

/** One API snapshot as Prometheus holds it: every pod's series, with labels. */
const apiVector = (paymentsPerPod) =>
  apiPods.flatMap((instance, i) => [
    [{ __name__: "payments_confirmed_total", job: "api", instance, event_id: EVENT }, paymentsPerPod[i]],
    [{ __name__: "orders_accepted_total", job: "api", instance }, paymentsPerPod[i]],
    [{ __name__: "reservations_created_total", job: "api", instance }, paymentsPerPod[i]],
    [{ __name__: "up", job: "api", instance }, 1],
    [{ __name__: "scrape_duration_seconds", job: "api", instance }, 0.01],
    [
      { __name__: "service_config_info", job: "api", instance, service: "api", node_env: "production" },
      1,
    ],
  ]);

const workerVector = (completed, e2eBuckets) => [
  [{ __name__: "orders_completed_total", job: "worker", instance: "worker-a", event_id: EVENT }, completed],
  [{ __name__: "order_e2e_latency_seconds_bucket", job: "worker", instance: "worker-a", le: "1" }, e2eBuckets[0]],
  [{ __name__: "order_e2e_latency_seconds_bucket", job: "worker", instance: "worker-a", le: "+Inf" }, e2eBuckets[1]],
  [{ __name__: "order_e2e_latency_seconds_count", job: "worker", instance: "worker-a" }, e2eBuckets[1]],
  [{ __name__: "order_e2e_latency_seconds_sum", job: "worker", instance: "worker-a" }, e2eBuckets[1] * 0.5],
];

/** Prometheus applies the snapshot selector; the fake mimics its name filter. */
const isServiceSeries = ([labels]) =>
  labels.__name__ !== "up" && !labels.__name__.startsWith("scrape_");

const snapshotFrom = async (series) => {
  const prom = fakePrometheus(() => series.filter(isServiceSeries));
  return snapshotJob("http://p", series[0][0].job, prom.fetchImpl);
};

test("snapshotJob asks for the service's series only, not scrape bookkeeping", async () => {
  const prom = fakePrometheus(() => []);
  await snapshotJob("http://p", "api", prom.fetchImpl);
  assert.deepEqual(prom.queries, [
    '{job="api", __name__!="up", __name__!~"scrape_.*"}',
  ]);
});

test("snapshotJob keeps every pod and drops the job label", async () => {
  const snap = await snapshotFrom(apiVector([1, 2, 3]));
  assert.deepEqual(snap.instances, apiPods);
  assert.ok(!snap.text.includes('job="'), "the file is per job; the label is noise");
  assert.equal(
    snap.text.split("\n").filter((l) => l.startsWith("payments_confirmed_total")).length,
    3,
  );
});

// Der eigentliche Messketten-Fall: drei API-Pods, je ein eigener Zaehler. Der
// Report muss die Summe der Pod-Deltas zeigen — vorher sah er nur den Pod,
// den der Service-Tunnel zufaellig traf.
test("the report counts across three API pods from Prometheus snapshots", async () => {
  const apiBefore = await snapshotFrom(apiVector([10, 20, 30]));
  const apiAfter = await snapshotFrom(apiVector([310, 420, 270]));
  const workerBefore = await snapshotFrom(workerVector(60, [50, 60]));
  const workerAfter = await snapshotFrom(workerVector(1_000, [900, 1_000]));

  const derived = deriveReport({
    manifest: { runId: "three-pods" },
    phaseA: { metrics: { iterations: { count: 940 }, dropped_iterations: {} } },
    metricsBefore: { api: apiBefore.text, worker: workerBefore.text },
    metricsAfter: { api: apiAfter.text, worker: workerAfter.text },
    policy,
  });

  // (310-10) + (420-20) + (270-30) = 940
  assert.equal(derived.counters.paymentsConfirmed.value, 940);
  assert.equal(derived.counters.ordersCompleted.value, 940);
  assert.equal(derived.e2eLatency.count, 940);
  // `instance` names the pod, it is no configuration value.
  assert.deepEqual(derived.serviceConfig.api, { node_env: "production" });
});

// --- Freshness after the TSDB reset ---

test("waitForFreshScrape returns once every target was scraped after the reset", async () => {
  const sinceMs = 1_790_000_000_000;
  const readings = [null, sinceMs / 1000 - 3, sinceMs / 1000 + 1];
  let i = 0;
  const prom = fakePrometheus(() => {
    const value = readings[Math.min(i++, readings.length - 1)];
    return value === null ? [] : [[{}, value]];
  });
  await waitForFreshScrape({
    baseUrl: "http://p",
    jobs: ["api", "worker"],
    sinceMs,
    sleep: async () => {},
    now: () => sinceMs,
    fetchImpl: prom.fetchImpl,
  });
  assert.equal(i, 3);
  assert.equal(prom.queries[0], 'min(timestamp(up{job=~"api|worker"}))');
});

test("waitForFreshScrape fails loudly when no fresh scrape arrives", async () => {
  let clock = 0;
  const prom = fakePrometheus(() => []);
  await assert.rejects(
    waitForFreshScrape({
      baseUrl: "http://p",
      jobs: ["api"],
      sinceMs: 0,
      timeoutMs: 10,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      fetchImpl: prom.fetchImpl,
    }),
    /No fresh scrape of api/,
  );
});
