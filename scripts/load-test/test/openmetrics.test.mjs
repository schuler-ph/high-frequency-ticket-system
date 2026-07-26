import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseOpenMetrics,
  sumSamples,
  getHistogram,
} from "../lib/openmetrics.mjs";

const SAMPLE = `# HELP orders_completed_total Completed orders
# TYPE orders_completed_total counter
orders_completed_total{event_id="a",status="ok"} 10
orders_completed_total{event_id="b",status="ok"} 5
redis_db_drift_tickets{job="worker"} -3

# TYPE order_e2e_latency_seconds histogram
order_e2e_latency_seconds_bucket{le="0.001",status="completed"} 2
order_e2e_latency_seconds_bucket{le="0.01",status="completed"} 6
order_e2e_latency_seconds_bucket{le="0.1",status="completed"} 9
order_e2e_latency_seconds_bucket{le="+Inf",status="completed"} 12
order_e2e_latency_seconds_count{status="completed"} 12
order_e2e_latency_seconds_sum{status="completed"} 1.5
process_start_time_seconds 1.7e9
`;

test("parseOpenMetrics skips comments and blanks and parses labels + values", () => {
  const samples = parseOpenMetrics(SAMPLE);
  const drift = samples.find((s) => s.name === "redis_db_drift_tickets");
  assert.equal(drift.value, -3);
  assert.equal(drift.labels.job, "worker");
  // A label-less sample with a scientific-notation value is parsed.
  const start = samples.find((s) => s.name === "process_start_time_seconds");
  assert.equal(start.value, 1.7e9);
});

test("parseOpenMetrics parses +Inf bucket boundary", () => {
  const samples = parseOpenMetrics(SAMPLE);
  const inf = samples.find(
    (s) =>
      s.name === "order_e2e_latency_seconds_bucket" && s.labels.le === "+Inf",
  );
  assert.equal(inf.value, 12);
});

test("parseOpenMetrics returns [] for empty / non-string input", () => {
  assert.deepEqual(parseOpenMetrics(""), []);
  assert.deepEqual(parseOpenMetrics(undefined), []);
});

test("sumSamples aggregates across matching label sets, null when absent", () => {
  const samples = parseOpenMetrics(SAMPLE);
  assert.equal(sumSamples(samples, "orders_completed_total"), 15);
  assert.equal(
    sumSamples(samples, "orders_completed_total", { event_id: "a" }),
    10,
  );
  assert.equal(sumSamples(samples, "does_not_exist_total"), null);
});

test("getHistogram reconstructs sorted buckets + count + sum", () => {
  const samples = parseOpenMetrics(SAMPLE);
  const hist = getHistogram(samples, "order_e2e_latency_seconds");
  assert.equal(hist.count, 12);
  assert.equal(hist.sum, 1.5);
  assert.deepEqual(
    hist.buckets.map((b) => b.le),
    [0.001, 0.01, 0.1, Number.POSITIVE_INFINITY],
  );
  assert.equal(hist.buckets[hist.buckets.length - 1].cumulativeCount, 12);
});

test("getHistogram returns null when the histogram is absent", () => {
  const samples = parseOpenMetrics(SAMPLE);
  assert.equal(getHistogram(samples, "no_such_histogram"), null);
});
