/**
 * Worker drain monitor.
 *
 * After generated traffic stops, in-flight orders keep being persisted. Drain
 * is complete only when pending has been zero (or below policy) for several
 * consecutive polls (automation doc, step 5):
 *
 *   pending = Δaccepted - Δcompleted - Δfailed   (Δ relative to the run baseline)
 *
 * The polling loop is written against injected `fetchCounters`/`sleep`/`now`
 * functions so the decision logic is unit-testable without a live worker; the
 * orchestrator supplies real implementations.
 */

/**
 * @param {{
 *   baseline: { accepted: number, completed: number, failed: number },
 *   fetchCounters: () => Promise<{ accepted: number, completed: number, failed: number }>,
 *   sleep: (ms: number) => Promise<void>,
 *   now: () => number,
 *   pollIntervalSeconds?: number,
 *   stablePolls?: number,
 *   timeoutSeconds?: number,
 * }} opts
 * @returns {Promise<{ status: "complete" | "timeout", pendingAtEnd: number, durationSeconds: number, polls: Array<{ pending: number }> }>}
 */
export const waitForDrain = async ({
  baseline,
  fetchCounters,
  sleep,
  now,
  pollIntervalSeconds = 5,
  stablePolls = 3,
  timeoutSeconds = 900,
}) => {
  const startedAt = now();
  const polls = [];
  let stableCount = 0;
  let lastPending = Number.POSITIVE_INFINITY;

  const deadline = startedAt + timeoutSeconds * 1000;

  while (now() < deadline) {
    await sleep(pollIntervalSeconds * 1000);

    let counters;
    try {
      counters = await fetchCounters();
    } catch {
      // Transient scrape failure: keep polling until the deadline.
      continue;
    }

    const pending =
      counters.accepted -
      baseline.accepted -
      (counters.completed - baseline.completed) -
      (counters.failed - baseline.failed);
    polls.push({ pending });
    lastPending = pending;

    if (pending <= 0) {
      stableCount += 1;
      if (stableCount >= stablePolls) {
        return {
          status: "complete",
          pendingAtEnd: pending,
          durationSeconds: (now() - startedAt) / 1000,
          polls,
        };
      }
    } else {
      stableCount = 0;
    }
  }

  return {
    status: "timeout",
    pendingAtEnd: Number.isFinite(lastPending) ? lastPending : 0,
    durationSeconds: (now() - startedAt) / 1000,
    polls,
  };
};
