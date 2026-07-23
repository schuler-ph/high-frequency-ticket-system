/**
 * Two independent verdicts for a load-test run (pure functions).
 *
 * A benchmark can be INVALID as a capacity proof while still providing strong
 * correctness evidence — Baseline A is the canonical example (invalid as proof
 * of 50k RPS, but every accepted order eventually completed). The two verdicts
 * are therefore computed separately (see the automation doc, "Validity rules").
 */

/**
 * @param {{
 *   droppedShare: number | null,
 *   scrapeGapSeconds: number | null,
 *   apiUp: boolean | null,
 *   workerUp: boolean | null,
 *   hasCounterBaselines: boolean,
 *   countersReset: boolean,
 * }} facts
 * @param {{
 *   maxDroppedIterationRateForValidRun: number,
 *   maxDroppedIterationRateForDegradedRun: number,
 *   maxScrapeGapSeconds: number,
 *   requireApiAndWorkerUp: boolean,
 *   requireCounterBaselines: boolean,
 * }} policy
 * @returns {{ verdict: "valid" | "degraded" | "invalid", reasons: string[] }}
 */
export const benchmarkValidity = (facts, policy) => {
  const reasons = [];
  let verdict = "valid";

  const degrade = (reason) => {
    if (verdict === "valid") verdict = "degraded";
    reasons.push(reason);
  };
  const invalidate = (reason) => {
    verdict = "invalid";
    reasons.push(reason);
  };

  if (facts.countersReset) {
    invalidate(
      "A service counter reset mid-run (after < before); run-scoped deltas are untrustworthy.",
    );
  }

  if (policy.requireCounterBaselines && !facts.hasCounterBaselines) {
    invalidate("Counter baselines were not captured before the run.");
  }

  if (policy.requireApiAndWorkerUp) {
    if (facts.apiUp === false) invalidate("API scrape target was not up.");
    if (facts.workerUp === false)
      invalidate("Worker scrape target was not up.");
  }

  if (facts.droppedShare !== null && facts.droppedShare !== undefined) {
    if (facts.droppedShare > policy.maxDroppedIterationRateForDegradedRun) {
      invalidate(
        `Dropped-iteration rate ${(facts.droppedShare * 100).toFixed(2)}% indicates load-generator saturation; capacity cannot be claimed.`,
      );
    } else if (facts.droppedShare > policy.maxDroppedIterationRateForValidRun) {
      degrade(
        `Dropped-iteration rate ${(facts.droppedShare * 100).toFixed(2)}% exceeds the valid-run warning limit.`,
      );
    }
  }

  if (
    facts.scrapeGapSeconds !== null &&
    facts.scrapeGapSeconds !== undefined &&
    facts.scrapeGapSeconds > policy.maxScrapeGapSeconds
  ) {
    degrade(
      `Longest scrape gap ${facts.scrapeGapSeconds}s exceeds the ${policy.maxScrapeGapSeconds}s limit.`,
    );
  }

  return { verdict, reasons };
};

/**
 * System correctness result. `inconclusive` when the run did not fully drain
 * (and the policy requires drain for a correctness verdict) or when any
 * invariant could not be evaluated for lack of operands. `fail` when a fully
 * evaluated invariant is violated.
 *
 * @param {{
 *   invariants: Array<{ id: string, ok: boolean | null }>,
 *   drainStatus: "complete" | "timeout" | "unknown",
 * }} facts
 * @param {{ requireDrainForCorrectnessVerdict: boolean }} policy
 * @returns {{ verdict: "pass" | "fail" | "inconclusive", reasons: string[] }}
 */
export const systemResult = (facts, policy) => {
  const reasons = [];
  const invariants = facts.invariants ?? [];

  const violated = invariants.filter((i) => i.ok === false);
  if (violated.length > 0) {
    return {
      verdict: "fail",
      reasons: violated.map((i) => `Invariant failed: ${i.id}.`),
    };
  }

  if (
    policy.requireDrainForCorrectnessVerdict &&
    facts.drainStatus !== "complete"
  ) {
    reasons.push(
      `Drain did not complete (status: ${facts.drainStatus}); correctness cannot be confirmed.`,
    );
    return { verdict: "inconclusive", reasons };
  }

  const notEvaluated = invariants.filter((i) => i.ok === null);
  if (notEvaluated.length > 0) {
    return {
      verdict: "inconclusive",
      reasons: notEvaluated.map(
        (i) => `Invariant could not be evaluated (missing operands): ${i.id}.`,
      ),
    };
  }

  if (invariants.length === 0) {
    return {
      verdict: "inconclusive",
      reasons: ["No invariants were evaluated."],
    };
  }

  return { verdict: "pass", reasons: ["All evaluated invariants hold."] };
};
