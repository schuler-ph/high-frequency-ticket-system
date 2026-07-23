#!/usr/bin/env node
/**
 * `spike:report` — the full evidence-collecting orchestrator.
 *
 * Runs the complete workflow (automation doc, "spike:report"): preflight ->
 * manifest -> reset/seed -> baseline snapshots -> phase A (reactive) + phase B
 * -> drain -> final snapshots -> deterministic analysis -> report -> policy
 * exit code. Evidence is always written before the process exits, even on a
 * failed or timed-out run.
 *
 * This is the side-effecting layer: it requires a live local stack (Docker
 * containers, running API/worker on the built stand, k6, Prometheus). The pure
 * analysis it delegates to is exercised by the unit + golden tests without any
 * of that. It is intended to be run once the Stage-4 capacity infrastructure
 * is in place (Baseline B).
 *
 * Usage: node scripts/load-test/run-and-report.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  loadPolicy,
  getGitInfo,
  getHostInfo,
  preflight,
  REPO_ROOT,
} from "./lib/config.mjs";
import { buildManifest, redactConfig } from "./lib/manifest.mjs";
import { snapshotPostgres, snapshotRedis } from "./lib/snapshots.mjs";
import { targetUp } from "./lib/prometheus.mjs";
import { waitForDrain } from "./lib/drain.mjs";
import { runPhaseAReactive, runPhaseB } from "./lib/processes.mjs";
import { parseOpenMetrics, sumSamples } from "./lib/openmetrics.mjs";
import { analyzeAndWrite } from "./analyze-run.mjs";

const EVENT_ID = process.env.EVENT_ID ?? "00000000-0000-4000-8000-000000000000";
const API_METRICS =
  process.env.API_METRICS_URL ?? "http://localhost:10002/metrics";
const WORKER_METRICS =
  process.env.WORKER_METRICS_URL ?? "http://localhost:10003/metrics";
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://localhost:10007";
const SALE_OPENS_IN_SECONDS = process.env.SALE_OPENS_IN_SECONDS ?? "60";

const nowIso = () => new Date().toISOString();
const stamp = () => nowIso().replace(/[:.]/g, "-");

const fetchText = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
};

/** Read the drain-relevant counters (accepted from API, completed/failed from worker). */
const fetchCounters = async () => {
  const api = parseOpenMetrics(await fetchText(API_METRICS));
  const worker = parseOpenMetrics(await fetchText(WORKER_METRICS));
  return {
    accepted: sumSamples(api, "orders_accepted_total") ?? 0,
    completed: sumSamples(worker, "orders_completed_total") ?? 0,
    failed: sumSamples(worker, "orders_failed_total") ?? 0,
  };
};

const main = async () => {
  const policy = loadPolicy();

  // 1. Preflight — fail before mutating any state.
  const pf = preflight();
  if (!pf.ok) {
    console.error("[spike:report] Preflight failed:");
    for (const problem of pf.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  // 2. Manifest identity.
  const git = getGitInfo();
  const runId = `${stamp()}-${git.commit.slice(0, 7)}`;
  const runDir = join(REPO_ROOT, "artifacts", "load-tests", runId);
  for (const sub of ["k6", "metrics", "state"]) {
    mkdirSync(join(runDir, sub), { recursive: true });
  }
  const timestamps = { seededAt: null };

  const k6Env = {
    ...process.env,
    BASE_URL: process.env.BASE_URL ?? "http://localhost:10002",
    EVENT_ID,
    K6_PROMETHEUS_RW_SERVER_URL:
      process.env.K6_PROMETHEUS_RW_SERVER_URL ??
      `${PROMETHEUS_URL}/api/v1/write`,
  };

  // 3. Reset / seed.
  console.log("[spike:report] Seeding local infrastructure...");
  execFileSync(
    "node",
    [join(REPO_ROOT, "scripts", "local", "reset-seed.mjs")],
    {
      stdio: "inherit",
      env: { ...process.env, SALE_OPENS_IN_SECONDS },
    },
  );
  timestamps.seededAt = nowIso();

  // 4. Baseline snapshots (state survives across the run for counter deltas).
  const stateBefore = {
    postgres: snapshotPostgres(EVENT_ID),
    redis: snapshotRedis(EVENT_ID),
  };
  const apiBefore = await fetchText(API_METRICS);
  const workerBefore = await fetchText(WORKER_METRICS);
  const drainBaseline = await fetchCounters();
  writeFileSync(join(runDir, "metrics", "api-before.prom"), apiBefore);
  writeFileSync(join(runDir, "metrics", "worker-before.prom"), workerBefore);
  writeFileSync(
    join(runDir, "state", "before.json"),
    JSON.stringify(stateBefore, null, 2) + "\n",
  );

  // 5. Phase A (reactive) + phase B.
  timestamps.workloadStartedAt = nowIso();
  const phaseAExit = await runPhaseAReactive({
    scriptPath: join(REPO_ROOT, "load-tests", "spike-phase-a.js"),
    runId,
    summaryPath: join(runDir, "k6", "phase-a-summary.json"),
    env: k6Env,
    metricsUrl: WORKER_METRICS,
    eventId: EVENT_ID,
  });
  timestamps.phaseAEndedAt = nowIso();
  writeFileSync(
    join(runDir, "k6", "phase-a-meta.json"),
    JSON.stringify({ exitCode: phaseAExit, reason: "reactive-phase-a" }) + "\n",
  );

  const phaseBExit = await runPhaseB({
    scriptPath: join(REPO_ROOT, "load-tests", "spike-phase-b.js"),
    runId,
    summaryPath: join(runDir, "k6", "phase-b-summary.json"),
    env: k6Env,
  });
  timestamps.workloadEndedAt = nowIso();
  writeFileSync(
    join(runDir, "k6", "phase-b-meta.json"),
    JSON.stringify({ exitCode: phaseBExit, reason: "cool-down" }) + "\n",
  );

  // 6. Drain.
  console.log("[spike:report] Waiting for worker drain...");
  const drain = await waitForDrain({
    baseline: drainBaseline,
    fetchCounters,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    pollIntervalSeconds: policy.drain.pollIntervalSeconds,
    stablePolls: policy.drain.stablePolls,
    timeoutSeconds: policy.drain.timeoutSeconds,
  });
  timestamps.drainEndedAt = nowIso();
  writeFileSync(
    join(runDir, "drain.json"),
    JSON.stringify(drain, null, 2) + "\n",
  );

  // 7. Final snapshots + health.
  const stateAfter = {
    postgres: snapshotPostgres(EVENT_ID),
    redis: snapshotRedis(EVENT_ID),
  };
  writeFileSync(
    join(runDir, "metrics", "api-after.prom"),
    await fetchText(API_METRICS),
  );
  writeFileSync(
    join(runDir, "metrics", "worker-after.prom"),
    await fetchText(WORKER_METRICS),
  );
  writeFileSync(
    join(runDir, "state", "after.json"),
    JSON.stringify(stateAfter, null, 2) + "\n",
  );

  const health = {
    apiUp: await targetUp(PROMETHEUS_URL, "api").catch(() => null),
    workerUp: await targetUp(PROMETHEUS_URL, "worker").catch(() => null),
    scrapeGapSeconds: null,
  };
  writeFileSync(
    join(runDir, "health.json"),
    JSON.stringify(health, null, 2) + "\n",
  );

  // 8. Manifest.
  const manifest = buildManifest({
    runId,
    git,
    host: getHostInfo(),
    profile: {
      phaseA: "load-tests/spike-phase-a.js",
      phaseB: "load-tests/spike-phase-b.js",
      eventId: EVENT_ID,
    },
    configuration: redactConfig(process.env),
    capacity: {
      totalCapacity: stateBefore.postgres.capacity,
      opensAt: null,
    },
    timestamps,
  });
  writeFileSync(
    join(runDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // 9. Deterministic analysis + report.
  const { derived } = analyzeAndWrite(runDir, policy);

  console.log(`[spike:report] Artifacts: ${runDir}`);
  console.log(
    `[spike:report] benchmark=${derived.validity.benchmark.verdict} system=${derived.validity.system.verdict} (k6 phaseA=${phaseAExit} phaseB=${phaseBExit})`,
  );

  // 10. Policy exit code — only after every artifact has been written.
  process.exit(derived.validity.system.verdict === "fail" ? 1 : 0);
};

main().catch((error) => {
  console.error("[spike:report] Failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
