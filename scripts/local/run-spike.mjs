import { execFileSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:10002";
const EVENT_ID =
  process.env.EVENT_ID ?? "00000000-0000-4000-8000-000000000000";
const SALE_OPENS_IN_SECONDS = Number(process.env.SALE_OPENS_IN_SECONDS ?? 60);
const POLL_INTERVAL_MS = Number(process.env.SPIKE_POLL_INTERVAL_MS ?? 3000);
const SOLDOUT_CONFIRM_POLLS = Number(
  process.env.SPIKE_SOLDOUT_CONFIRM_POLLS ?? 3,
);
const GRACEFUL_STOP_TIMEOUT_MS = Number(
  process.env.SPIKE_GRACEFUL_STOP_TIMEOUT_MS ?? 40_000,
);
const PROMETHEUS_RW_URL =
  process.env.K6_PROMETHEUS_RW_SERVER_URL ??
  "http://localhost:10007/api/v1/write";

const k6Env = {
  ...process.env,
  BASE_URL,
  EVENT_ID,
  K6_PROMETHEUS_RW_SERVER_URL: PROMETHEUS_RW_URL,
};

/**
 * Startet ein k6-Script als Kindprozess und liefert sowohl den Prozess selbst
 * (fuer Signal-Handling) als auch ein Promise auf den Exit-Code.
 */
const spawnK6 = (scriptPath) => {
  const child = spawn(
    "k6",
    ["run", "--out", "experimental-prometheus-rw", scriptPath],
    { stdio: "inherit", env: k6Env },
  );

  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });

  return { child, exitPromise };
};

/**
 * Pollt die Availability-Route, bis entweder `available` fuer
 * SOLDOUT_CONFIRM_POLLS aufeinanderfolgende Polls bei 0 steht (Sold-Out
 * bestaetigt, deterministisch statt auf einen einzigen Ausreisser zu
 * reagieren) oder der Kindprozess von selbst beendet wurde.
 */
const pollUntilSoldOutOrExit = async (exitPromise) => {
  let childExited = false;
  exitPromise.then(() => {
    childExited = true;
  });

  let consecutiveZero = 0;

  while (!childExited) {
    await sleep(POLL_INTERVAL_MS);
    if (childExited) break;

    try {
      const res = await fetch(
        `${BASE_URL}/api/tickets/${EVENT_ID}/availability`,
      );
      if (!res.ok) continue;

      const body = await res.json();

      if (typeof body.available === "number" && body.available <= 0) {
        consecutiveZero += 1;
      } else {
        consecutiveZero = 0;
      }

      if (consecutiveZero >= SOLDOUT_CONFIRM_POLLS) {
        console.log(
          "[run-spike] Sold out detected — stopping the sustain stage gracefully.",
        );
        return true;
      }
    } catch (error) {
      console.warn(
        `[run-spike] Availability poll failed, retrying: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return false;
};

// k6 beendet sich mit 99, wenn mindestens ein Threshold verletzt wurde — das
// ist ein Test-Ergebnis, kein Absturz des Load-Generators (siehe
// docs/LOAD-TEST-REPORT-AUTOMATION.md, "preserve exit semantics"). Jeder andere
// Nicht-Null-Code ist ein echter Betriebsfehler (k6 liess sich nicht starten,
// Skriptfehler o.ae.).
const K6_THRESHOLD_FAILED_EXIT_CODE = 99;
const isExpectedK6Exit = (code) =>
  code === 0 || code === K6_THRESHOLD_FAILED_EXIT_CODE;

/**
 * Faehrt Phase A reaktiv und liefert den k6-Exit-Code zurueck (oder `null`,
 * wenn k6 per SIGKILL beendet werden musste). Wirft nur bei einem echten
 * Betriebsfehler — ein Threshold-Fehler (Exit 99) wird durchgereicht, damit
 * Phase B trotzdem laeuft und der finale Policy-Exit-Code stimmt.
 */
const runPhaseAReactively = async () => {
  const { child, exitPromise } = spawnK6("load-tests/spike-phase-a.js");
  const soldOut = await pollUntilSoldOutOrExit(exitPromise);

  if (!soldOut) {
    const exitCode = await exitPromise;
    if (!isExpectedK6Exit(exitCode)) {
      throw new Error(
        `Phase A (k6) exited with an operational error (code ${exitCode}) before sell-out was detected.`,
      );
    }
    console.log(
      `[run-spike] Phase A finished on its own without a confirmed sell-out (k6 exit ${exitCode}; 15m ceiling reached or thresholds evaluated).`,
    );
    return exitCode;
  }

  child.kill("SIGINT");

  const raceResult = await Promise.race([
    exitPromise.then((code) => ({ status: "exited", code })),
    sleep(GRACEFUL_STOP_TIMEOUT_MS).then(() => ({ status: "timeout" })),
  ]);

  if (raceResult.status === "timeout") {
    console.warn(
      "[run-spike] k6 did not stop gracefully in time, forcing shutdown.",
    );
    child.kill("SIGKILL");
    await exitPromise;
    return null;
  }

  return raceResult.code;
};

const runPhaseB = async () => {
  const { exitPromise } = spawnK6("load-tests/spike-phase-b.js");
  return exitPromise;
};

const main = async () => {
  console.log(
    "Web: http://localhost:10001 , Prometheus Server: http://localhost:10007 , Grafana Server: http://localhost:10008",
  );

  console.log(
    `[run-spike] Seeding local infrastructure (sale opens in ${SALE_OPENS_IN_SECONDS}s)...`,
  );
  execFileSync("node", ["scripts/local/reset-seed.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      SALE_OPENS_IN_SECONDS: String(SALE_OPENS_IN_SECONDS),
    },
  });

  console.log(
    "[run-spike] Phase A: warm-up (1k/45s) -> ramp (1k->5k/45s) -> sustain (5k, until sold out)...",
  );
  const phaseAExitCode = await runPhaseAReactively();

  console.log("[run-spike] Phase B: cool-down (1k/1min)...");
  const phaseBExitCode = await runPhaseB();

  // Policy-Exit-Code: ein k6-Threshold-Fehler (Exit 99) in einer der Phasen ist
  // ein legitimes Test-Ergebnis und wird weitergereicht — er darf aber Phase B
  // nicht ueberspringen. Ein echter Betriebsfehler haette oben bereits geworfen.
  process.exit(phaseBExitCode || phaseAExitCode || 0);
};

main().catch((error) => {
  console.error("[run-spike] Failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
