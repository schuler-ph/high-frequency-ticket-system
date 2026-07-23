/**
 * Deterministic, side-effect-free load-test calculations.
 *
 * Every function is a pure calculation over already-collected evidence so it
 * can be unit-tested without running the expensive load test
 * (docs/suggested/LOAD-TEST-REPORT-AUTOMATION.md, "Deterministic
 * calculations"). Nothing here reads the clock, the network, or the database.
 */

/**
 * Counter delta with process-restart detection. A monotonic counter that went
 * DOWN between the before/after snapshot means the exporting process restarted
 * mid-run; the delta is then untrustworthy and the run should be marked
 * inconclusive rather than silently reporting a negative or wrapped count.
 *
 * @param {number | null} before
 * @param {number | null} after
 * @returns {{ value: number | null, reset: boolean, hasBaseline: boolean }}
 */
export const counterDelta = (before, after) => {
  if (after === null || after === undefined) {
    return { value: null, reset: false, hasBaseline: before !== null };
  }
  if (before === null || before === undefined) {
    // No baseline captured: cannot compute a run-scoped delta safely.
    return { value: null, reset: false, hasBaseline: false };
  }
  if (after < before) {
    return { value: null, reset: true, hasBaseline: true };
  }
  return { value: after - before, reset: false, hasBaseline: true };
};

/**
 * Executed vs. dropped share for an arrival-rate executor. For a reactive
 * profile there is no fixed intended count beyond the period actually run, so
 * `iterations + dropped` is the authoritative scheduled count.
 *
 * @param {{ iterations: number, droppedIterations: number }} input
 * @returns {{ scheduled: number, executedShare: number, droppedShare: number }}
 */
export const droppedShare = ({ iterations, droppedIterations }) => {
  const safeIterations = Math.max(0, iterations ?? 0);
  const safeDropped = Math.max(0, droppedIterations ?? 0);
  const scheduled = safeIterations + safeDropped;
  if (scheduled === 0) {
    return { scheduled: 0, executedShare: 0, droppedShare: 0 };
  }
  return {
    scheduled,
    executedShare: safeIterations / scheduled,
    droppedShare: safeDropped / scheduled,
  };
};

/**
 * Mean of a histogram from its cumulative sum and count. Returns `null` when
 * the count is zero or either operand is missing (no observations => no mean).
 *
 * @param {{ sum: number | null, count: number | null }} histogram
 * @returns {number | null}
 */
export const histogramMean = ({ sum, count }) => {
  if (sum === null || sum === undefined) return null;
  if (count === null || count === undefined || count === 0) return null;
  return sum / count;
};

/**
 * Histogram saturation: the fraction of observations that fell ABOVE the
 * largest finite bucket. If this is non-trivial, a reported high quantile from
 * a dashboard is censored at the top bucket rather than measured (the
 * Baseline-A `30s` p50/p95/p99 illusion).
 *
 * @param {Array<{ le: number, cumulativeCount: number }>} buckets Sorted ascending by `le`, `+Inf` last.
 * @returns {{ largestFiniteLe: number | null, countAtLargestFinite: number, totalCount: number, fractionAboveLargestFinite: number } | null}
 */
export const histogramSaturation = (buckets) => {
  if (!Array.isArray(buckets) || buckets.length === 0) return null;

  const infBucket = buckets.find((b) => !Number.isFinite(b.le));
  const totalCount = infBucket
    ? infBucket.cumulativeCount
    : buckets[buckets.length - 1].cumulativeCount;

  const finiteBuckets = buckets.filter((b) => Number.isFinite(b.le));
  if (finiteBuckets.length === 0) {
    return {
      largestFiniteLe: null,
      countAtLargestFinite: 0,
      totalCount,
      fractionAboveLargestFinite: totalCount > 0 ? 1 : 0,
    };
  }

  const largest = finiteBuckets[finiteBuckets.length - 1];
  const fractionAboveLargestFinite =
    totalCount > 0 ? 1 - largest.cumulativeCount / totalCount : 0;

  return {
    largestFiniteLe: largest.le,
    countAtLargestFinite: largest.cumulativeCount,
    totalCount,
    fractionAboveLargestFinite,
  };
};

/**
 * Resolve a quantile against cumulative bucket counts. If the target rank lies
 * above the largest finite bucket, the value is censored: it is rendered as
 * `> Bmax` (with `censored: true`) instead of pretending it equals `Bmax`.
 *
 * @param {Array<{ le: number, cumulativeCount: number }>} buckets
 * @param {number} quantile Between 0 and 1.
 * @returns {{ le: number, censored: boolean } | null}
 */
export const quantileFromBuckets = (buckets, quantile) => {
  if (!Array.isArray(buckets) || buckets.length === 0) return null;
  if (quantile <= 0 || quantile > 1) return null;

  const infBucket = buckets.find((b) => !Number.isFinite(b.le));
  const totalCount = infBucket
    ? infBucket.cumulativeCount
    : buckets[buckets.length - 1].cumulativeCount;
  if (totalCount <= 0) return null;

  const rank = quantile * totalCount;
  const finiteBuckets = buckets.filter((b) => Number.isFinite(b.le));
  const largestFinite = finiteBuckets[finiteBuckets.length - 1];

  if (largestFinite && rank > largestFinite.cumulativeCount) {
    return { le: largestFinite.le, censored: true };
  }

  for (const bucket of finiteBuckets) {
    if (bucket.cumulativeCount >= rank) {
      return { le: bucket.le, censored: false };
    }
  }
  return largestFinite
    ? { le: largestFinite.le, censored: true }
    : { le: buckets[0].le, censored: false };
};

/**
 * Redis-vs-DB drift identity (ADR-023):
 * drift = redisAvailable - (capacity - soldCount - activeReservations).
 *
 * @param {{ redisAvailable: number, capacity: number, soldCount: number, activeReservations: number }} input
 * @returns {number}
 */
export const drift = ({
  redisAvailable,
  capacity,
  soldCount,
  activeReservations,
}) => redisAvailable - (capacity - soldCount - activeReservations);

/**
 * Evaluate the final correctness invariants at completed drain. Each invariant
 * is only asserted when its operands are available; missing operands produce an
 * `inconclusive` invariant rather than a false failure.
 *
 * @param {{
 *   accepted: number | null,
 *   completed: number | null,
 *   failed: number | null,
 *   dbOrders: number | null,
 *   dbTickets: number | null,
 *   pendingOrders: number | null,
 * }} facts
 * @returns {Array<{ id: string, ok: boolean | null, expected: number | null, actual: number | null }>}
 */
export const evaluateInvariants = (facts) => {
  const { accepted, completed, failed, dbOrders, dbTickets, pendingOrders } =
    facts;

  const check = (id, expected, actual) => {
    if (
      expected === null ||
      expected === undefined ||
      actual === null ||
      actual === undefined
    ) {
      return {
        id,
        ok: null,
        expected: expected ?? null,
        actual: actual ?? null,
      };
    }
    return { id, ok: expected === actual, expected, actual };
  };

  const finalized =
    completed !== null &&
    completed !== undefined &&
    failed !== null &&
    failed !== undefined
      ? completed + failed
      : null;

  return [
    check("accepted == completed + failed", accepted, finalized),
    check("dbOrders == completed + failed", dbOrders, finalized),
    check("dbTickets == completed", dbTickets, completed ?? null),
    check("pendingOrders == 0", 0, pendingOrders ?? null),
  ];
};
