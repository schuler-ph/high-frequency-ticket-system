/**
 * k6 process orchestration for the report collector.
 *
 * Spawns each phase with a run tag and a per-phase `--summary-export` JSON, and
 * runs phase A reactively — stopping it with a graceful SIGINT once the worker
 * completion counter plateaus (sell-out). This mirrors the proven detection in
 * scripts/local/run-spike.mjs (ADR-025 / correction #235), kept self-contained
 * here so the collector controls the summary-export paths and exit-code capture
 * (automation doc, step 3-4). k6's threshold-fail exit code (99) is preserved
 * as a test result, never treated as a collector crash.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const K6_THRESHOLD_FAILED_EXIT_CODE = 99;

/**
 * @param {string} scriptPath
 * @param {{ runId: string, summaryPath: string, env: NodeJS.ProcessEnv, prometheusRw?: boolean }} opts
 */
export const spawnK6 = (
  scriptPath,
  { runId, summaryPath, env, prometheusRw = true },
) => {
  const args = ["run"];
  if (prometheusRw) args.push("--out", "experimental-prometheus-rw");
  args.push(
    "--summary-export",
    summaryPath,
    "--tag",
    `test_run_id=${runId}`,
    scriptPath,
  );
  const child = spawn("k6", args, { stdio: "inherit", env });
  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });
  return { child, exitPromise };
};

/** Read the monotonic `orders_completed_total` from the worker /metrics text. */
export const fetchCompletedCount = async (
  metricsUrl,
  eventId,
  fetchImpl = fetch,
) => {
  const res = await fetchImpl(metricsUrl);
  if (!res.ok) return null;
  const text = await res.text();
  let total = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("orders_completed_total")) continue;
    if (line.includes("{") && eventId && !line.includes(eventId)) continue;
    const value = Number(line.slice(line.lastIndexOf(" ") + 1));
    if (Number.isFinite(value)) total = (total ?? 0) + value;
  }
  return total;
};

/**
 * Poll the worker completion counter until it plateaus RELATIVE to the first
 * observed value (self-healing against the process-lifetime counter carryover;
 * see run-spike correction #235), or until the child exits on its own.
 *
 * @returns {Promise<boolean>} true when sell-out was detected.
 */
export const pollUntilSoldOut = async (
  exitPromise,
  { metricsUrl, eventId, pollIntervalMs = 3000, confirmPolls = 3 },
) => {
  let childExited = false;
  exitPromise.then(() => {
    childExited = true;
  });

  let baseline = null;
  let last = null;
  let stalls = 0;

  while (!childExited) {
    await sleep(pollIntervalMs);
    if (childExited) break;
    let completed;
    try {
      completed = await fetchCompletedCount(metricsUrl, eventId);
    } catch {
      continue;
    }
    if (completed === null) continue;
    if (baseline === null) {
      baseline = completed;
      last = completed;
      continue;
    }
    if (completed > baseline && completed === last) {
      stalls += 1;
    } else {
      stalls = 0;
    }
    last = completed;
    if (stalls >= confirmPolls) return true;
  }
  return false;
};

export const isExpectedK6Exit = (code) =>
  code === 0 || code === K6_THRESHOLD_FAILED_EXIT_CODE;

/**
 * Run phase A reactively; graceful SIGINT on sell-out. Returns the k6 exit code
 * (or null if it had to be SIGKILLed).
 */
export const runPhaseAReactive = async ({
  scriptPath,
  runId,
  summaryPath,
  env,
  metricsUrl,
  eventId,
  pollIntervalMs,
  confirmPolls,
  gracefulStopTimeoutMs = 40_000,
}) => {
  const { child, exitPromise } = spawnK6(scriptPath, {
    runId,
    summaryPath,
    env,
  });
  const soldOut = await pollUntilSoldOut(exitPromise, {
    metricsUrl,
    eventId,
    pollIntervalMs,
    confirmPolls,
  });

  if (!soldOut) {
    const exitCode = await exitPromise;
    if (!isExpectedK6Exit(exitCode)) {
      throw new Error(
        `Phase A (k6) exited with operational error ${exitCode}.`,
      );
    }
    return exitCode;
  }

  child.kill("SIGINT");
  const race = await Promise.race([
    exitPromise.then((code) => ({ status: "exited", code })),
    sleep(gracefulStopTimeoutMs).then(() => ({ status: "timeout" })),
  ]);
  if (race.status === "timeout") {
    child.kill("SIGKILL");
    await exitPromise;
    return null;
  }
  return race.code;
};

/** Run phase B to completion; returns the k6 exit code. */
export const runPhaseB = async ({ scriptPath, runId, summaryPath, env }) => {
  const { exitPromise } = spawnK6(scriptPath, { runId, summaryPath, env });
  return exitPromise;
};
