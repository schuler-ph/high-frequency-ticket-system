/**
 * Pure composition layer: turn already-collected artifacts into a `derived`
 * result object. No filesystem, network, or database access — the entry script
 * (`analyze-run.mjs`) reads the artifact files and hands the parsed contents
 * here, so this whole module is unit-testable with in-memory fixtures.
 */

import { parseOpenMetrics, sumSamples, getHistogram } from "./openmetrics.mjs";
import {
  counterDelta,
  droppedShare,
  histogramMean,
  histogramSaturation,
  quantileFromBuckets,
  drift as driftIdentity,
  evaluateInvariants,
} from "./derive.mjs";
import { benchmarkValidity, systemResult } from "./validate.mjs";

export const DERIVED_SCHEMA_VERSION = 1;
export const RENDERER_VERSION = 1;

/**
 * Read a value bag from a k6 summary metric, tolerating both the
 * `--summary-export` shape (fields directly on the metric) and the
 * `handleSummary(data)` shape (fields under `.values`).
 *
 * @param {object | undefined} metric
 * @returns {Record<string, number>}
 */
const metricValues = (metric) => metric?.values ?? metric ?? {};

/**
 * Normalise one k6 phase summary + orchestrator meta into a flat record.
 *
 * @param {object | null} summary Raw k6 summary JSON.
 * @param {{ exitCode?: number, reason?: string } | null} meta
 * @param {string} name
 * @returns {object | null}
 */
export const summarisePhase = (summary, meta, name) => {
  if (!summary) return null;
  const metrics = summary.metrics ?? {};
  const iters = metricValues(metrics.iterations);
  const dropped = metricValues(metrics.dropped_iterations);
  const duration = metricValues(metrics.http_req_duration);
  const failed = metricValues(metrics.http_req_failed);
  const vus = metricValues(metrics.vus_max);

  const iterations = iters.count ?? 0;
  const droppedIterations = dropped.count ?? 0;
  const share = droppedShare({ iterations, droppedIterations });

  return {
    name,
    iterations,
    droppedIterations,
    scheduled: share.scheduled,
    executedShare: share.executedShare,
    droppedShare: share.droppedShare,
    httpReqs: metricValues(metrics.http_reqs).count ?? null,
    duration: {
      avg: duration.avg ?? null,
      med: duration.med ?? null,
      p90: duration["p(90)"] ?? null,
      p95: duration["p(95)"] ?? null,
      p99: duration["p(99)"] ?? null,
      max: duration.max ?? null,
    },
    failedRate: failed.rate ?? failed.value ?? null,
    vusMax: vus.max ?? vus.value ?? null,
    exitCode: meta?.exitCode ?? null,
    reason: meta?.reason ?? null,
  };
};

const COUNTER_QUERIES = {
  ordersAccepted: { metric: "orders_accepted_total", source: "api" },
  reservationsCreated: { metric: "reservations_created_total", source: "api" },
  publishRollbacks: { metric: "publish_rollbacks_total", source: "api" },
  checkoutsCancelled: { metric: "checkouts_cancelled_total", source: "api" },
  ordersCompleted: { metric: "orders_completed_total", source: "worker" },
  ordersFailed: { metric: "orders_failed_total", source: "worker" },
  workerRedeliveries: { metric: "worker_redeliveries_total", source: "worker" },
  workerIdempotencyHits: {
    metric: "worker_idempotency_hits_total",
    source: "worker",
  },
  workerCompensations: {
    metric: "worker_compensations_total",
    source: "worker",
  },
};

/**
 * Delta between two parsed histogram snapshots (run-scoped observations).
 *
 * @param {ReturnType<typeof getHistogram>} before
 * @param {ReturnType<typeof getHistogram>} after
 */
const histogramDelta = (before, after) => {
  if (!after) return null;
  const beforeByLe = new Map(
    (before?.buckets ?? []).map((b) => [b.le, b.cumulativeCount]),
  );
  const buckets = after.buckets.map((b) => ({
    le: b.le,
    cumulativeCount: b.cumulativeCount - (beforeByLe.get(b.le) ?? 0),
  }));
  const count =
    after.count === null ? null : after.count - (before?.count ?? 0);
  const sum = after.sum === null ? null : after.sum - (before?.sum ?? 0);
  return { buckets, count, sum };
};

/**
 * Build the full derived result from parsed artifacts.
 *
 * @param {{
 *   manifest: object,
 *   phaseA?: object | null,
 *   phaseB?: object | null,
 *   phaseAMeta?: object | null,
 *   phaseBMeta?: object | null,
 *   metricsBefore?: { api?: string, worker?: string },
 *   metricsAfter?: { api?: string, worker?: string },
 *   stateBefore?: object | null,
 *   stateAfter?: object | null,
 *   drain?: object | null,
 *   health?: { apiUp?: boolean | null, workerUp?: boolean | null, scrapeGapSeconds?: number | null },
 *   policy: object,
 * }} input
 * @returns {object}
 */
export const deriveReport = (input) => {
  const {
    manifest,
    phaseA = null,
    phaseB = null,
    phaseAMeta = null,
    phaseBMeta = null,
    metricsBefore = {},
    metricsAfter = {},
    stateBefore = null,
    stateAfter = null,
    drain = null,
    health = {},
    policy,
  } = input;

  const samples = {
    apiBefore: parseOpenMetrics(metricsBefore.api ?? ""),
    workerBefore: parseOpenMetrics(metricsBefore.worker ?? ""),
    apiAfter: parseOpenMetrics(metricsAfter.api ?? ""),
    workerAfter: parseOpenMetrics(metricsAfter.worker ?? ""),
  };

  // --- Offered vs. executed load ---
  const phases = [
    summarisePhase(phaseA, phaseAMeta, "phase-a"),
    summarisePhase(phaseB, phaseBMeta, "phase-b"),
  ].filter(Boolean);
  const totalIterations = phases.reduce((s, p) => s + p.iterations, 0);
  const totalDropped = phases.reduce((s, p) => s + p.droppedIterations, 0);
  const offeredShare = droppedShare({
    iterations: totalIterations,
    droppedIterations: totalDropped,
  });

  // --- Counter deltas (before/after direct metrics) ---
  const counters = {};
  let anyCounterReset = false;
  let allCountersHaveBaseline = phases.length > 0;
  for (const [key, { metric, source }] of Object.entries(COUNTER_QUERIES)) {
    const before = sumSamples(
      source === "api" ? samples.apiBefore : samples.workerBefore,
      metric,
    );
    const after = sumSamples(
      source === "api" ? samples.apiAfter : samples.workerAfter,
      metric,
    );
    const delta = counterDelta(before, after);
    counters[key] = { before, after, ...delta };
    if (delta.reset) anyCounterReset = true;
    if (!delta.hasBaseline) allCountersHaveBaseline = false;
  }

  // --- E2E latency (run-scoped histogram delta) ---
  const e2eBefore = getHistogram(
    samples.workerBefore,
    "order_e2e_latency_seconds",
  );
  const e2eAfter = getHistogram(
    samples.workerAfter,
    "order_e2e_latency_seconds",
  );
  const e2eHist = histogramDelta(e2eBefore, e2eAfter);
  const e2eLatency = e2eHist
    ? {
        count: e2eHist.count,
        sum: e2eHist.sum,
        mean: histogramMean({ sum: e2eHist.sum, count: e2eHist.count }),
        saturation: histogramSaturation(e2eHist.buckets),
        quantiles: {
          p50: quantileFromBuckets(e2eHist.buckets, 0.5),
          p95: quantileFromBuckets(e2eHist.buckets, 0.95),
          p99: quantileFromBuckets(e2eHist.buckets, 0.99),
        },
      }
    : null;

  // --- Drift ---
  const capacity = stateAfter?.postgres?.capacity ?? null;
  const soldCount = stateAfter?.postgres?.soldCount ?? null;
  const activeReservations = stateAfter?.redis?.activeReservations ?? null;
  const redisAvailable = stateAfter?.redis?.available ?? null;
  const driftFinal =
    capacity !== null &&
    soldCount !== null &&
    activeReservations !== null &&
    redisAvailable !== null
      ? driftIdentity({
          redisAvailable,
          capacity,
          soldCount,
          activeReservations,
        })
      : null;
  const driftMin = drain?.driftMin ?? driftFinal;

  // --- Invariants ---
  const invariants = evaluateInvariants({
    accepted: counters.ordersAccepted.value,
    completed: counters.ordersCompleted.value,
    failed: counters.ordersFailed.value,
    dbOrders: stateAfter?.postgres?.orders ?? null,
    dbTickets: stateAfter?.postgres?.tickets ?? null,
    pendingOrders: stateAfter?.postgres?.pendingOrders ?? null,
  });

  // --- Validity verdicts ---
  const benchmark = benchmarkValidity(
    {
      droppedShare: phases.length > 0 ? offeredShare.droppedShare : null,
      scrapeGapSeconds: health.scrapeGapSeconds ?? null,
      apiUp: health.apiUp ?? null,
      workerUp: health.workerUp ?? null,
      hasCounterBaselines: allCountersHaveBaseline,
      countersReset: anyCounterReset,
    },
    policy.benchmark,
  );
  const system = systemResult(
    { invariants, drainStatus: drain?.status ?? "unknown" },
    policy.benchmark,
  );

  const recommendations = buildRecommendations({
    offeredShare,
    e2eLatency,
    invariants,
    drainStatus: drain?.status ?? "unknown",
    policy,
  });

  return {
    schemaVersion: DERIVED_SCHEMA_VERSION,
    rendererVersion: RENDERER_VERSION,
    runId: manifest?.runId ?? "unknown",
    git: manifest?.git ?? null,
    host: manifest?.host ?? null,
    configuration: manifest?.configuration ?? {},
    capacity: manifest?.capacity ?? null,
    offeredLoad: {
      phases,
      totalIterations,
      totalDropped,
      scheduled: offeredShare.scheduled,
      droppedShare: offeredShare.droppedShare,
      executedShare: offeredShare.executedShare,
    },
    counters,
    e2eLatency,
    drain: drain
      ? {
          status: drain.status ?? "unknown",
          pendingAtEnd: drain.pendingAtEnd ?? null,
          durationSeconds: drain.durationSeconds ?? null,
        }
      : { status: "unknown", pendingAtEnd: null, durationSeconds: null },
    state: {
      postgres: stateAfter?.postgres ?? null,
      redis: stateAfter?.redis ?? null,
    },
    drift: { min: driftMin, final: driftFinal },
    invariants,
    validity: { benchmark, system },
    recommendations,
  };
};

/**
 * Rule-based recommendations (automation doc, "Report template"). Each carries
 * the evidence it was derived from — never prose-only reasoning.
 */
const buildRecommendations = ({
  offeredShare,
  e2eLatency,
  invariants,
  drainStatus,
  policy,
}) => {
  const recs = [];

  if (
    offeredShare.scheduled > 0 &&
    offeredShare.droppedShare >
      policy.benchmark.maxDroppedIterationRateForValidRun
  ) {
    recs.push({
      id: "generator-saturated",
      message:
        "Load generator dropped scheduled iterations; do not claim the target RPS as backend capacity.",
      evidence: [`droppedShare=${offeredShare.droppedShare}`],
    });
  }

  const frac = e2eLatency?.saturation?.fractionAboveLargestFinite ?? 0;
  if (frac > policy.histogram.maxFractionAboveLargestBucketForValid) {
    recs.push({
      id: "e2e-histogram-censored",
      message:
        "Extend the E2E histogram buckets; the reported upper quantiles are censored at the largest finite bucket.",
      evidence: [`fractionAboveLargestFinite=${frac}`],
    });
  }

  const violated = invariants.filter((i) => i.ok === false);
  if (violated.length > 0 && drainStatus === "complete") {
    recs.push({
      id: "invariant-failed",
      message:
        "A correctness invariant failed after a completed drain; investigate before trusting throughput numbers.",
      evidence: violated.map((i) => i.id),
    });
  }

  return recs;
};
