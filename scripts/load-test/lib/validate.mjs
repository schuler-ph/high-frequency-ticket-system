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

/**
 * Up to four decimals, trailing zeros trimmed — enough to show `0.0512` next
 * to a `rate<0.05` gate without rounding it onto the limit.
 *
 * @param {number} value
 * @returns {string}
 */
const fmtObserved = (value) =>
  Number.isInteger(value)
    ? String(value)
    : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

/**
 * Performance verdict from the k6 thresholds the phase scripts declare
 * (`load-tests/spike-phase-*.js`). Third, independent dimension next to
 * benchmark validity (was the generator big enough?) and system result (did
 * the inventory stay correct?): a run can be valid and correct and still too
 * slow for its users. Baseline E reported `system: pass` twice with a p95 of
 * 876 ms against a 500 ms threshold, because latency entered neither verdict
 * (ADR-036).
 *
 * Only the metrics listed in `policy.gates` are judged. The same `thresholds`
 * map also carries export-only selectors (`transport_errors{endpoint:*}` with
 * `count>=0`) that exist purely to materialise sub-metrics in the summary;
 * treating "any breached threshold" as a failure would be right today by
 * accident and wrong the first time such a selector flips.
 *
 * @param {{
 *   phases: Array<{
 *     name: string,
 *     thresholds: Array<{
 *       metric: string,
 *       expression: string,
 *       breached: boolean,
 *       observed: number | null,
 *     }> | null,
 *   }>,
 * }} facts
 * @param {{ gates: string[] } | undefined} policy
 * @returns {{ verdict: "pass" | "fail" | "inconclusive", reasons: string[] }}
 */
export const performanceVerdict = (facts, policy) => {
  const gates = policy?.gates ?? [];
  if (gates.length === 0) {
    return {
      verdict: "inconclusive",
      reasons: ["No performance gates are configured in the report policy."],
    };
  }

  const phases = (facts.phases ?? []).filter(
    (p) => p.thresholds !== null && p.thresholds !== undefined,
  );
  if (phases.length === 0) {
    return {
      verdict: "inconclusive",
      reasons: [
        "No k6 thresholds were exported; the artifact predates the performance verdict.",
      ],
    };
  }

  const breached = [];
  const missing = [];
  for (const phase of phases) {
    for (const gate of gates) {
      const declared = phase.thresholds.filter((t) => t.metric === gate);
      if (declared.length === 0) {
        missing.push(`Gate ${gate} was not declared in ${phase.name}.`);
        continue;
      }
      for (const t of declared) {
        if (!t.breached) continue;
        const observed =
          t.observed === null
            ? "observed value not exported"
            : `observed ${fmtObserved(t.observed)}`;
        breached.push(
          `${t.metric} ${t.expression} breached in ${phase.name} (${observed}).`,
        );
      }
    }
  }

  if (breached.length > 0) return { verdict: "fail", reasons: breached };
  if (missing.length > 0) return { verdict: "inconclusive", reasons: missing };
  return {
    verdict: "pass",
    reasons: ["All performance gates held in every phase."],
  };
};
