/**
 * Compare two derived load-test results (pure).
 *
 * A comparison is only meaningful when the two runs are compatible: same
 * seeded capacity, same load profile, clean Git state, and a candidate whose
 * benchmark validity actually supports a capacity claim (automation doc,
 * "spike:compare"). Incompatibilities are reported rather than silently
 * papered over; deltas are still computed for transparency but must not be read
 * as a capacity verdict when `compatible` is false.
 */

/**
 * @param {number | null | undefined} baseline
 * @param {number | null | undefined} candidate
 * @returns {{ baseline: number | null, candidate: number | null, absolute: number | null, percent: number | null }}
 */
const delta = (baseline, candidate) => {
  const b = baseline ?? null;
  const c = candidate ?? null;
  if (b === null || c === null) {
    return { baseline: b, candidate: c, absolute: null, percent: null };
  }
  return {
    baseline: b,
    candidate: c,
    absolute: c - b,
    percent: b === 0 ? null : (c - b) / b,
  };
};

/**
 * @param {object} baseline derived.json of the baseline run
 * @param {object} candidate derived.json of the candidate run
 * @returns {{ compatible: boolean, incompatibilities: string[], deltas: Record<string, object>, verdicts: object }}
 */
export const compareRuns = (baseline, candidate) => {
  const incompatibilities = [];

  const baseCap = baseline?.capacity?.totalCapacity ?? null;
  const candCap = candidate?.capacity?.totalCapacity ?? null;
  if (baseCap !== candCap) {
    incompatibilities.push(
      `Seeded capacity differs (baseline ${baseCap} vs candidate ${candCap}).`,
    );
  }

  const baseProfile = baseline?.configuration?.LOAD_PROFILE ?? null;
  const candProfile = candidate?.configuration?.LOAD_PROFILE ?? null;
  if (baseProfile !== candProfile) {
    incompatibilities.push(
      `Load profile differs (baseline ${baseProfile} vs candidate ${candProfile}).`,
    );
  }

  if (candidate?.git?.dirty) {
    incompatibilities.push(
      "Candidate Git state is dirty; run is not reproducible.",
    );
  }

  if (candidate?.validity?.benchmark?.verdict === "invalid") {
    incompatibilities.push(
      "Candidate benchmark is invalid; capacity deltas cannot be claimed.",
    );
  }

  // Quantiles are read off histogram buckets; two runs with different bucket
  // ladders interpolate differently and their p95/p99 are not comparable. The
  // ladder changed in Phase 4.13 (denser 1–5 s range), so this must be said
  // rather than silently interpolated across.
  const baseLadder = baseline?.e2eLatency?.bucketBoundaries;
  const candLadder = candidate?.e2eLatency?.bucketBoundaries;
  if (
    Array.isArray(baseLadder) &&
    Array.isArray(candLadder) &&
    JSON.stringify(baseLadder) !== JSON.stringify(candLadder)
  ) {
    incompatibilities.push(
      `E2E histogram bucket ladders differ (baseline ${baseLadder.length} vs candidate ${candLadder.length} finite buckets); latency quantiles are not comparable.`,
    );
  }

  const deltas = {
    droppedShare: delta(
      baseline?.offeredLoad?.droppedShare,
      candidate?.offeredLoad?.droppedShare,
    ),
    e2eMean: delta(baseline?.e2eLatency?.mean, candidate?.e2eLatency?.mean),
    ordersCompleted: delta(
      baseline?.counters?.ordersCompleted?.value,
      candidate?.counters?.ordersCompleted?.value,
    ),
    driftFinal: delta(baseline?.drift?.final, candidate?.drift?.final),
  };

  return {
    compatible: incompatibilities.length === 0,
    incompatibilities,
    deltas,
    verdicts: {
      baseline: {
        benchmark: baseline?.validity?.benchmark?.verdict ?? null,
        system: baseline?.validity?.system?.verdict ?? null,
        performance: baseline?.validity?.performance?.verdict ?? null,
      },
      candidate: {
        benchmark: candidate?.validity?.benchmark?.verdict ?? null,
        system: candidate?.validity?.system?.verdict ?? null,
        performance: candidate?.validity?.performance?.verdict ?? null,
      },
    },
  };
};

/**
 * Render a comparison as deterministic Markdown.
 *
 * @param {ReturnType<typeof compareRuns>} comparison
 * @param {{ baselineId?: string, candidateId?: string }} [labels]
 * @returns {string}
 */
export const renderComparison = (comparison, labels = {}) => {
  const lines = [];
  lines.push(
    `# Load-Test Comparison — \`${labels.baselineId ?? "baseline"}\` → \`${labels.candidateId ?? "candidate"}\``,
    "",
  );
  lines.push(
    `**Compatible for a capacity claim:** ${comparison.compatible ? "yes ✅" : "no ❌"}`,
    "",
  );
  if (!comparison.compatible) {
    lines.push("## Incompatibilities", "");
    for (const reason of comparison.incompatibilities)
      lines.push(`- ${reason}`);
    lines.push("");
  }
  lines.push("## Deltas", "");
  lines.push("| Metric | Baseline | Candidate | Δ | Δ% |");
  lines.push("| ------ | -------- | --------- | - | -- |");
  for (const key of Object.keys(comparison.deltas)) {
    const d = comparison.deltas[key];
    const pct = d.percent === null ? "n/a" : `${(d.percent * 100).toFixed(1)}%`;
    lines.push(
      `| ${key} | ${fmt(d.baseline)} | ${fmt(d.candidate)} | ${fmt(d.absolute)} | ${pct} |`,
    );
  }
  lines.push("");
  return lines.join("\n") + "\n";
};

const fmt = (value) => {
  if (value === null || value === undefined || Number.isNaN(value))
    return "n/a";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4);
};
