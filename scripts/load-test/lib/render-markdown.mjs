/**
 * Deterministic Markdown renderer for a derived load-test result (pure).
 *
 * Rendering the same `derived` object twice MUST produce byte-identical output
 * (automation doc, "Idempotence"): no wall-clock timestamps, no locale-
 * dependent formatting, stable section and key ordering.
 */

/** Manual, locale-independent thousands grouping. */
const groupThousands = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * @param {number | null | undefined} value
 * @returns {string}
 */
const fmtInt = (value) => {
  if (value === null || value === undefined || Number.isNaN(value))
    return "n/a";
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return sign + groupThousands(String(Math.abs(rounded)));
};

/**
 * @param {number | null | undefined} value
 * @param {number} [decimals]
 * @returns {string}
 */
const fmtFloat = (value, decimals = 3) => {
  if (value === null || value === undefined || Number.isNaN(value))
    return "n/a";
  if (!Number.isFinite(value)) return value > 0 ? "+Inf" : "-Inf";
  return value.toFixed(decimals);
};

/**
 * @param {number | null | undefined} share
 * @returns {string}
 */
const fmtPct = (share) => {
  if (share === null || share === undefined || Number.isNaN(share))
    return "n/a";
  return `${(share * 100).toFixed(2)}%`;
};

/** Escape a value for use inside a Markdown table cell. */
const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");

const fmtQuantile = (q) => {
  if (!q) return "n/a";
  return q.censored ? `> ${fmtFloat(q.le)}s` : `${fmtFloat(q.le)}s`;
};

const VERDICT_ICON = {
  valid: "✅",
  degraded: "⚠️",
  invalid: "❌",
  pass: "✅",
  fail: "❌",
  inconclusive: "❔",
};

/**
 * @param {object} derived
 * @returns {string}
 */
export const renderReport = (derived) => {
  const lines = [];
  const push = (...l) => lines.push(...l);

  push(`# Load-Test Report — \`${derived.runId}\``, "");

  // 1. Run identity & configuration
  push("## 1. Run Identity & Configuration", "");
  if (derived.git) {
    push(
      `- **Git:** \`${derived.git.commit}\` (${derived.git.branch})${derived.git.dirty ? " — dirty" : ""}`,
    );
  }
  if (derived.host) {
    push(
      `- **Host:** ${derived.host.platform}/${derived.host.arch}, ${fmtInt(derived.host.cpuCount)} CPUs`,
    );
  }
  if (derived.capacity) {
    push(`- **Seeded capacity:** ${fmtInt(derived.capacity.totalCapacity)}`);
  }
  const configKeys = Object.keys(derived.configuration ?? {}).sort();
  if (configKeys.length > 0) {
    push("- **Configuration:**");
    for (const key of configKeys) {
      push(`  - \`${key}\` = \`${derived.configuration[key]}\``);
    }
  }
  push("");

  // 2. Executive verdict
  const bench = derived.validity.benchmark;
  const system = derived.validity.system;
  push("## 2. Executive Verdict", "");
  push(
    `- **Benchmark validity:** ${VERDICT_ICON[bench.verdict] ?? ""} \`${bench.verdict}\``,
  );
  push(
    `- **System result:** ${VERDICT_ICON[system.verdict] ?? ""} \`${system.verdict}\``,
  );
  push("");

  // 3. Benchmark validity detail
  push("## 3. Benchmark Validity", "");
  if (bench.reasons.length > 0) {
    for (const reason of bench.reasons) push(`- ${reason}`);
  } else {
    push("- No validity concerns recorded.");
  }
  push("");

  // 4. Offered vs. executed load
  push("## 4. Offered vs. Executed Load", "");
  push("| Phase | Iterations | Dropped | Scheduled | Executed % | VUs max |");
  push("| ----- | ---------- | ------- | --------- | ---------- | ------- |");
  for (const p of derived.offeredLoad.phases) {
    push(
      `| ${cell(p.name)} | ${fmtInt(p.iterations)} | ${fmtInt(p.droppedIterations)} | ${fmtInt(p.scheduled)} | ${fmtPct(p.executedShare)} | ${fmtInt(p.vusMax)} |`,
    );
  }
  push(
    `| **total** | ${fmtInt(derived.offeredLoad.totalIterations)} | ${fmtInt(derived.offeredLoad.totalDropped)} | ${fmtInt(derived.offeredLoad.scheduled)} | ${fmtPct(derived.offeredLoad.executedShare)} | |`,
  );
  push("");

  // 5. Worker throughput & counters
  push("## 5. Order Counters (run-scoped deltas)", "");
  push("| Counter | Before | After | Δ Run |");
  push("| ------- | ------ | ----- | ----- |");
  for (const key of Object.keys(derived.counters).sort()) {
    const c = derived.counters[key];
    const deltaLabel = c.reset ? "reset!" : fmtInt(c.value);
    push(
      `| ${cell(key)} | ${fmtInt(c.before)} | ${fmtInt(c.after)} | ${deltaLabel} |`,
    );
  }
  push("");

  // 6. Drain
  push("## 6. Worker Drain", "");
  push(`- **Status:** \`${derived.drain.status}\``);
  push(`- **Pending at end:** ${fmtInt(derived.drain.pendingAtEnd)}`);
  push(
    `- **Drain duration:** ${derived.drain.durationSeconds === null ? "n/a" : `${fmtFloat(derived.drain.durationSeconds, 1)}s`}`,
  );
  push("");

  // 7. E2E latency & histogram coverage
  push("## 7. E2E Latency & Histogram Coverage", "");
  if (derived.e2eLatency) {
    const e = derived.e2eLatency;
    push(`- **Observations:** ${fmtInt(e.count)}`);
    push(
      `- **Mean:** ${e.mean === null ? "n/a" : `${fmtFloat(e.mean)}s`} (Δsum/Δcount)`,
    );
    push(
      `- **p50 / p95 / p99:** ${fmtQuantile(e.quantiles.p50)} / ${fmtQuantile(e.quantiles.p95)} / ${fmtQuantile(e.quantiles.p99)}`,
    );
    if (e.saturation) {
      push(
        `- **Above-largest-bucket fraction:** ${fmtPct(e.saturation.fractionAboveLargestFinite)} (largest finite bucket ${fmtFloat(e.saturation.largestFiniteLe)}s)`,
      );
    }
  } else {
    push("- E2E latency histogram was not available.");
  }
  push("");

  // 8. Correctness invariants
  push("## 8. Correctness Invariants", "");
  push("| Invariant | Expected | Actual | Result |");
  push("| --------- | -------- | ------ | ------ |");
  for (const inv of derived.invariants) {
    const result =
      inv.ok === true ? "✅" : inv.ok === false ? "❌" : "❔ (unevaluable)";
    push(
      `| ${cell(inv.id)} | ${fmtInt(inv.expected)} | ${fmtInt(inv.actual)} | ${result} |`,
    );
  }
  push("");

  // 9. Redis / PostgreSQL consistency
  push("## 9. Redis / PostgreSQL Consistency", "");
  push(`- **Drift (final):** ${fmtInt(derived.drift.final)}`);
  push(`- **Drift (min):** ${fmtInt(derived.drift.min)}`);
  if (derived.state.redis) {
    push(
      `- **Redis:** available ${fmtInt(derived.state.redis.available)}, active reservations ${fmtInt(derived.state.redis.activeReservations)}, keys ${fmtInt(derived.state.redis.dbSize)}, used memory ${fmtInt(derived.state.redis.usedMemoryBytes)} bytes`,
    );
  }
  if (derived.state.postgres) {
    push(
      `- **PostgreSQL:** orders ${fmtInt(derived.state.postgres.orders)}, tickets ${fmtInt(derived.state.postgres.tickets)}, pending ${fmtInt(derived.state.postgres.pendingOrders)}, sold_count ${fmtInt(derived.state.postgres.soldCount)}`,
    );
  }
  push("");

  // 10. Recommendations
  push("## 10. Rule-Based Recommendations", "");
  if (derived.recommendations.length > 0) {
    for (const rec of derived.recommendations) {
      push(`- **${rec.id}:** ${rec.message}`);
      push(`  - evidence: ${rec.evidence.map((e) => `\`${e}\``).join(", ")}`);
    }
  } else {
    push("- No rule triggered.");
  }
  push("");

  push(
    `_Renderer v${derived.rendererVersion}. Regenerated deterministically from artifacts; no wall-clock timestamp embedded._`,
  );

  return lines.join("\n") + "\n";
};
