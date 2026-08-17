import { execFileSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  requireEnv,
  requireEnvBoolean,
  requireEnvNumber,
} from "../lib/require-env.mjs";

const BASE_URL = requireEnv("BASE_URL");
const EVENT_ID = requireEnv("EVENT_ID");
const SALE_OPENS_IN_SECONDS = requireEnvNumber("SALE_OPENS_IN_SECONDS");
const POLL_INTERVAL_MS = requireEnvNumber("SPIKE_POLL_INTERVAL_MS");
const SOLDOUT_CONFIRM_POLLS = requireEnvNumber("SPIKE_SOLDOUT_CONFIRM_POLLS");
const GRACEFUL_STOP_TIMEOUT_MS = requireEnvNumber(
  "SPIKE_GRACEFUL_STOP_TIMEOUT_MS",
);
const PROMETHEUS_RW_URL = requireEnv("K6_PROMETHEUS_RW_SERVER_URL");
// Sold-Out wird an den TATSAECHLICH abgeschlossenen Orders erkannt (monotoner
// Worker-Counter `orders_completed_total`), nicht mehr am reserve-getriebenen
// `available`: seit der Abandonment-/Cancel-Modellierung (ADR-028) oszilliert
// `available` (Cancel macht `INCR available`) und kann 0 kurz treffen und wieder
// steigen — das stoppte Phase A verfrueht. Der Completion-Counter kann nur
// steigen; ein Plateau ueber mehrere Polls bedeutet, dass keine Verkaeufe mehr
// durchgehen (Inventar durch Sales + Phantom-Reservierungen erschoepft).
const WORKER_METRICS_URL = requireEnv("WORKER_METRICS_URL");

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
  // Prometheus-Remote-Write ist bewusst opt-in (`K6_PROMETHEUS_RW=true`): die
  // `{endpoint,status}`-Tags pro Iteration trieben `hts-prometheus` in Baseline B
  // auf 5,5 GiB, bis es mit `503` antwortete — und nahmen damit genau die
  // Health-/Peak-Auswertung mit, die der Report braucht (Report §4.1).
  const args = ["run"];
  if (requireEnvBoolean("K6_PROMETHEUS_RW")) {
    args.push("--out", "experimental-prometheus-rw");
  }
  args.push(scriptPath);

  const child = spawn("k6", args, { stdio: "inherit", env: k6Env });

  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });

  return { child, exitPromise };
};

/**
 * Liest den monotonen Worker-Counter `orders_completed_total` (Summe ueber alle
 * `event_id`-Labels, bzw. gefiltert auf EVENT_ID) aus dem Prometheus-`/metrics`-
 * Text. Liefert `null`, wenn der Counter (noch) nicht exponiert ist.
 */
/**
 * Liest den Rest-Bestand aus der Availability-Route, um ein Completion-Plateau
 * von einem echten Ausverkauf zu unterscheiden. Liefert `null`, wenn der Wert
 * nicht lesbar ist — dann bleibt das Plateau bewusst unklassifiziert, statt
 * einen Ausverkauf zu behaupten, der nicht belegt ist.
 */
export const fetchAvailableCount = async () => {
  try {
    const res = await fetch(`${BASE_URL}/api/tickets/${EVENT_ID}/availability`);
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.available === "number" ? body.available : null;
  } catch {
    return null;
  }
};

export const fetchCompletedCount = async () => {
  const res = await fetch(WORKER_METRICS_URL);
  if (!res.ok) return null;
  const text = await res.text();

  let total = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("orders_completed_total")) continue;
    // Optional auf das Ziel-Event filtern; ohne Label-Match zaehlen wir alle.
    if (line.includes("{") && !line.includes(EVENT_ID)) continue;
    const value = Number(line.slice(line.lastIndexOf(" ") + 1));
    if (Number.isFinite(value)) total = (total ?? 0) + value;
  }
  return total;
};

/**
 * Pollt den Completion-Fortschritt, bis er fuer SOLDOUT_CONFIRM_POLLS
 * aufeinanderfolgende Polls stagniert (kein neuer abgeschlossener Order —
 * Sold-Out bestaetigt) oder der Kindprozess von selbst beendet wurde.
 *
 * `orders_completed_total` ist ein PROZESS-LEBENSDAUER-Counter des Workers: er
 * ueberlebt ein `reset-seed`/`pnpm spike` (der Worker-Prozess wird nicht
 * neugestartet), startet also mit einem CARRYOVER aus dem vorigen Lauf (> 0).
 * Ein absoluter Guard `completed > 0` reicht deshalb NICHT — er wuerde die
 * Pre-Sale-Phase, in der der stale Counter legitim auf dem Carryover-Wert
 * stagniert, sofort als Sold-Out fehldeuten. Stattdessen wird der Wert beim
 * ersten Poll als `baseline` festgehalten; ein Plateau gilt erst als Sold-Out,
 * wenn RELATIV zur baseline neue Orders abgeschlossen wurden (`completed >
 * baseline`) und die Zahl dann stagniert.
 */
export const pollUntilSoldOutOrExit = async (exitPromise) => {
  let childExited = false;
  exitPromise.then(() => {
    childExited = true;
  });

  let baseline = null;
  let lastCompleted = null;
  let consecutiveStall = 0;

  while (!childExited) {
    await sleep(POLL_INTERVAL_MS);
    if (childExited) break;

    try {
      const completed = await fetchCompletedCount();
      if (completed === null) continue;

      // Erster verwertbarer Poll: Carryover aus dem vorigen Worker-Leben als
      // baseline festhalten und noch nicht auf Sold-Out pruefen.
      if (baseline === null) {
        baseline = completed;
        lastCompleted = completed;
        continue;
      }

      // Nur stagnieren lassen, wenn seit Lauf-Start (baseline) ueberhaupt neue
      // Orders abgeschlossen wurden — sonst wuerde die Pre-Sale-Phase (Counter
      // steht auf dem stale Carryover-Wert) sofort Sold-Out melden.
      if (completed > baseline && completed === lastCompleted) {
        consecutiveStall += 1;
      } else {
        consecutiveStall = 0;
      }
      lastCompleted = completed;

      if (consecutiveStall >= SOLDOUT_CONFIRM_POLLS) {
        // Ein Plateau allein ist KEIN Ausverkauf: unter Generator-Saturation
        // genuegen drei Polls (~9 s) ohne neue Completion, obwohl noch Inventar
        // da ist. Baseline B stoppte so bei 888 s von 990 s mit 89.359 noch
        // verfuegbaren Tickets und beantwortete damit nie, wie lange ein
        // 1M-Ausverkauf dauert (Report §4.5). Deshalb gegen den Rest-Bestand
        // pruefen und den Grund benennen.
        const available = await fetchAvailableCount();
        if (available === 0) {
          console.log(
            `[run-spike] Sold out detected — completed orders plateaued at ${completed} (baseline ${baseline}) and available is 0 — stopping the sustain stage gracefully.`,
          );
        } else {
          console.warn(
            `[run-spike] STALL (not a sell-out) — completed orders plateaued at ${completed} (baseline ${baseline}) but ${available ?? "unknown"} tickets are still available. Stopping the sustain stage; do NOT read this run as a completed sale.`,
          );
        }
        return true;
      }
    } catch (error) {
      console.warn(
        `[run-spike] Completion poll failed, retrying: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return false;
};

// k6 beendet sich mit 99, wenn mindestens ein Threshold verletzt wurde — das
// ist ein Test-Ergebnis, kein Absturz des Load-Generators (siehe
// scripts/load-test/README.md, "Exit semantics"). Jeder andere
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

  // Nur der Reset, nicht die Provisionierung: die ist beim Hochfahren des
  // Stacks passiert. Hier zaehlt der Zeitpunkt, weil `opensAt` ab jetzt laeuft.
  console.log(
    `[run-spike] Resetting run state (sale opens in ${SALE_OPENS_IN_SECONDS}s)...`,
  );
  execFileSync("node", ["scripts/local/reset.mjs"], {
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

// Nur ausfuehren, wenn das Skript direkt gestartet wurde (`node run-spike.mjs`
// bzw. `pnpm spike`) — beim Import (z.B. aus einem Test) laeuft `main()` nicht,
// damit die Detection-Funktionen isoliert testbar bleiben.
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((error) => {
    console.error("[run-spike] Failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
