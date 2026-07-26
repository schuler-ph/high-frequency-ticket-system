import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildK6Args,
  classifyPlateau,
  fetchCompletedCount,
  isExpectedK6Exit,
  pollUntilSoldOut,
} from "../lib/processes.mjs";

// --- k6 argv / Prometheus remote-write default ---

// Regression for Baseline B (report §4.1): k6's remote-write drove Prometheus to
// 5.5 GiB and a 503, destroying the health facts and peak queries the report
// actually needs. It is never a report input, so it must be opt-in.
test("k6 runs without Prometheus remote-write by default", () => {
  const args = buildK6Args("phase-a.js", {
    runId: "r1",
    summaryPath: "s.json",
  });
  assert.ok(!args.includes("--out"), `unexpected --out in ${args.join(" ")}`);
  assert.ok(args.includes("--summary-export"));
});

test("remote-write can be opted into explicitly", () => {
  const args = buildK6Args("phase-a.js", {
    runId: "r1",
    summaryPath: "s.json",
    prometheusRw: true,
  });
  assert.deepEqual(args.slice(0, 3), [
    "run",
    "--out",
    "experimental-prometheus-rw",
  ]);
});

test("isExpectedK6Exit treats a threshold failure as a result, not a crash", () => {
  assert.equal(isExpectedK6Exit(0), true);
  assert.equal(isExpectedK6Exit(99), true);
  assert.equal(isExpectedK6Exit(1), false);
});

// --- Plateau classification ---

test("classifyPlateau only calls exhausted inventory a sell-out", () => {
  assert.equal(classifyPlateau(0), "sold-out");
  assert.equal(classifyPlateau(1), "stalled");
  assert.equal(classifyPlateau(89_359), "stalled");
});

/** Serve a scripted sequence of `orders_completed_total` values. */
const metricsSequence = (values) => {
  let i = 0;
  return async () => ({
    ok: true,
    text: async () =>
      `orders_completed_total ${values[Math.min(i++, values.length - 1)]}\n`,
  });
};

test("fetchCompletedCount sums the counter from /metrics text", async () => {
  const total = await fetchCompletedCount(
    "http://x/metrics",
    undefined,
    metricsSequence([42]),
  );
  assert.equal(total, 42);
});

test("fetchCompletedCount returns null on a failed scrape", async () => {
  const total = await fetchCompletedCount("http://x/metrics", undefined, async () => ({
    ok: false,
  }));
  assert.equal(total, null);
});

// The core Baseline-B regression (report §4.5): phase A stopped at 888s of 990s
// while 89 359 tickets were still available, and the run was treated as a
// sell-out. A plateau with inventory left must be reported as a stall.
test("a completion plateau with inventory left is a stall, not a sell-out", async () => {
  const never = new Promise(() => {});
  const result = await pollUntilSoldOut(never, {
    metricsUrl: "http://x/metrics",
    eventId: "e-1",
    pollIntervalMs: 1,
    confirmPolls: 2,
    readAvailable: async () => 89_359,
    fetchImpl: metricsSequence([1, 5, 5, 5, 5]),
  });
  assert.equal(result.stopped, true);
  assert.equal(result.reason, "stalled");
  assert.equal(result.available, 89_359);
});

test("a completion plateau at zero inventory is a real sell-out", async () => {
  const never = new Promise(() => {});
  const result = await pollUntilSoldOut(never, {
    metricsUrl: "http://x/metrics",
    eventId: "e-1",
    pollIntervalMs: 1,
    confirmPolls: 2,
    readAvailable: async () => 0,
    fetchImpl: metricsSequence([1, 5, 5, 5, 5]),
  });
  assert.equal(result.reason, "sold-out");
  assert.equal(result.available, 0);
});

// Without an inventory reading the detector must not upgrade a plateau to a
// sell-out it cannot prove.
test("an unreadable inventory leaves the plateau unclassified (stalled)", async () => {
  const never = new Promise(() => {});
  const result = await pollUntilSoldOut(never, {
    metricsUrl: "http://x/metrics",
    eventId: "e-1",
    pollIntervalMs: 1,
    confirmPolls: 2,
    readAvailable: async () => {
      throw new Error("redis-cli unavailable");
    },
    fetchImpl: metricsSequence([1, 5, 5, 5, 5]),
  });
  assert.equal(result.reason, "stalled");
  assert.equal(result.available, null);
});
