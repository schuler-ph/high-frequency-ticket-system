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
 * Build the k6 argv for one phase (pure, so the remote-write default is
 * testable without spawning k6).
 *
 * `prometheusRw` defaults to **false**: k6's remote-write is not an input to the
 * report at all — every PromQL query in `load-tests/report-queries.json` targets
 * `job="api"`/`job="worker"`, never a `k6_*` series. It exists purely to watch
 * Grafana live during a run, and at capacity volume it is actively harmful: the
 * per-iteration `{endpoint,status}` tags drove `hts-prometheus` to 5.5 GiB during
 * Baseline B until it answered `503`, which cost that run its `apiUp`/`workerUp`
 * health facts and both peak-throughput range queries — i.e. it destroyed the
 * data the report does need (report §4.1). Opt in with `K6_PROMETHEUS_RW=true`
 * for a low-volume debugging run.
 *
 * @param {string} scriptPath
 * @param {{ runId: string, summaryPath: string, prometheusRw?: boolean }} opts
 * @returns {string[]}
 */
export const buildK6Args = (
  scriptPath,
  { runId, summaryPath, prometheusRw = false },
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
  return args;
};

/**
 * @param {string} scriptPath
 * @param {{ runId: string, summaryPath: string, env: NodeJS.ProcessEnv, prometheusRw?: boolean }} opts
 */
export const spawnK6 = (
  scriptPath,
  {
    runId,
    summaryPath,
    env,
    prometheusRw = env?.K6_PROMETHEUS_RW === "true",
  },
) => {
  const args = buildK6Args(scriptPath, { runId, summaryPath, prometheusRw });
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
 * Classify a completion plateau against remaining inventory: only an exhausted
 * `available` counter is a genuine sell-out; a plateau with stock left is a stall
 * (host contention, generator saturation, wedged consumer).
 *
 * @param {number} available
 * @returns {"sold-out" | "stalled"}
 */
export const classifyPlateau = (available) =>
  available === 0 ? "sold-out" : "stalled";

/**
 * Poll the worker completion counter until it plateaus RELATIVE to the first
 * observed value (self-healing against the process-lifetime counter carryover;
 * see run-spike correction #235), or until the child exits on its own.
 *
 * A plateau alone does NOT mean sold out. Under generator saturation the host is
 * contended enough that three consecutive polls (~9s) can pass with no new
 * completion while inventory remains: Baseline B stopped phase A at 888s of 990s
 * with 89 359 tickets still available, so that run never answered how long a 1M
 * sell-out takes (report §4.5). When `readAvailable` is supplied the plateau is
 * therefore classified — `available === 0` is a real sell-out, anything else is a
 * stall. Both stop the phase (burning the remaining 15min safety net measures
 * nothing), but the reason is reported so the analysis cannot mistake a stall for
 * a completed sale.
 *
 * @param {Promise<number>} exitPromise
 * @param {{ metricsUrl: string, eventId: string, pollIntervalMs?: number, confirmPolls?: number, readAvailable?: (eventId: string) => Promise<number | null>, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ stopped: boolean, reason: "sold-out" | "stalled" | "k6-exited", available: number | null, completed: number | null }>}
 */
export const pollUntilSoldOut = async (
  exitPromise,
  {
    metricsUrl,
    eventId,
    pollIntervalMs = 3000,
    confirmPolls = 3,
    readAvailable,
    fetchImpl = fetch,
  },
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
      completed = await fetchCompletedCount(metricsUrl, eventId, fetchImpl);
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

    if (stalls >= confirmPolls) {
      let available = null;
      if (readAvailable) {
        try {
          available = await readAvailable(eventId);
        } catch {
          available = null;
        }
      }
      return {
        stopped: true,
        // Without an inventory reading the plateau stays unclassified rather
        // than being asserted as a sell-out.
        reason: available === null ? "stalled" : classifyPlateau(available),
        available,
        completed,
      };
    }
  }

  return { stopped: false, reason: "k6-exited", available: null, completed: last };
};

export const isExpectedK6Exit = (code) =>
  code === 0 || code === K6_THRESHOLD_FAILED_EXIT_CODE;

/**
 * Run phase A reactively; graceful SIGINT once the completion counter plateaus.
 *
 * @returns {Promise<{ exitCode: number | null, stopReason: "sold-out" | "stalled" | "k6-exited", availableAtStop: number | null }>}
 *   `exitCode` is null only when k6 had to be SIGKILLed. `stopReason`
 *   distinguishes a real sell-out from a plateau with inventory left, so the
 *   report never presents a stalled run as a completed sale (report §4.5).
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
  readAvailable,
  gracefulStopTimeoutMs = 40_000,
}) => {
  const { child, exitPromise } = spawnK6(scriptPath, {
    runId,
    summaryPath,
    env,
  });
  const plateau = await pollUntilSoldOut(exitPromise, {
    metricsUrl,
    eventId,
    pollIntervalMs,
    confirmPolls,
    readAvailable,
  });

  if (!plateau.stopped) {
    const exitCode = await exitPromise;
    if (!isExpectedK6Exit(exitCode)) {
      throw new Error(
        `Phase A (k6) exited with operational error ${exitCode}.`,
      );
    }
    return { exitCode, stopReason: "k6-exited", availableAtStop: null };
  }

  child.kill("SIGINT");
  const race = await Promise.race([
    exitPromise.then((code) => ({ status: "exited", code })),
    sleep(gracefulStopTimeoutMs).then(() => ({ status: "timeout" })),
  ]);
  if (race.status === "timeout") {
    child.kill("SIGKILL");
    await exitPromise;
    return {
      exitCode: null,
      stopReason: plateau.reason,
      availableAtStop: plateau.available,
    };
  }
  return {
    exitCode: race.code,
    stopReason: plateau.reason,
    availableAtStop: plateau.available,
  };
};

/** Run phase B to completion; returns the k6 exit code. */
export const runPhaseB = async ({ scriptPath, runId, summaryPath, env }) => {
  const { exitPromise } = spawnK6(scriptPath, { runId, summaryPath, env });
  return exitPromise;
};
