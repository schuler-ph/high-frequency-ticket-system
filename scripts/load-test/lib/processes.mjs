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
// k6 `errext/exitcodes.ExternalAbort`: der Lauf wurde von aussen gestoppt.
// Empirisch (k6 v2.0.0, 1-VU-Dummy): der REST-Stop selbst beendet k6 mit 103
// und `msg="test run stopped from REST API"` — der Summary-Export wird
// trotzdem geschrieben. Das ist unkritisch, weil nach einem VON UNS
// angeforderten Stop kein Exit-Code mehr gegated wird (nur Doku in
// phase-a-meta.json); `isExpectedK6Exit` bewertet ausschliesslich Laeufe,
// die OHNE unseren Stop endeten, und dort bleibt 103 ein echter Fehler
// (GenericEngine). 105 bleibt als dokumentierter ExternalAbort erwartet.
const K6_EXTERNAL_ABORT_EXIT_CODE = 105;

/**
 * Der explizite Env-Kontrakt der k6-Skripte (`load-tests/lib/
 * scenario-helpers.js` liest jeden Wert per `requireEnv*`). Lokal erbt k6 das
 * Prozess-Env des Orchestrators; ueber ssh wird das Env NICHT weitergereicht,
 * deshalb baut `buildRemoteK6Args` aus dieser Liste `-e`-Flags. Ein Test
 * gleicht die Liste gegen die `requireEnv`-Aufrufe im Skript ab, damit ein
 * neuer Skript-Knopf hier nicht still fehlt.
 *
 * `HTS_ENV_PROFILE` ist im Skript optional (nur Fehlermeldungs-Kontext),
 * gehoert aber dazu, damit Remote-Fehlermeldungen das Profil nennen.
 */
export const K6_SCRIPT_ENV_KEYS = [
  "BASE_URL",
  "EVENT_ID",
  "LOAD_PROFILE",
  "CHECKOUT_SHARE",
  "PAY_RATE",
  "CANCEL_RATE",
  "THINK_TIME_KIND",
  "THINK_TIME_MIN",
  "THINK_TIME_MAX",
  "THINK_TIME_MEAN",
  "THINK_TIME_SIGMA",
  "CHECKOUT_POLL",
  "CHECKOUT_POLL_MAX_ATTEMPTS",
  "CHECKOUT_POLL_INTERVAL",
  "HTS_ENV_PROFILE",
];

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

/**
 * Build the k6 argv for a REMOTE phase (pure). Unterschiede zum lokalen Lauf:
 *
 * - `--address` startet k6s REST-API auf dem Generator-Host, damit der
 *   Orchestrator den Sold-out-Stop per `stopK6ViaRest` ausloesen kann — ein
 *   SIGINT laesst sich ueber Windows-OpenSSH nicht zuverlaessig zustellen.
 * - Der Env-Kontrakt geht als `-e`-Flags mit, weil ssh das Prozess-Env nicht
 *   weiterreicht. Nur gesetzte Werte werden uebergeben; fehlt ein Pflichtwert,
 *   bricht das k6-Skript selbst mit Namensnennung ab (ADR-034).
 * - Kein Prometheus-Remote-Write: fuer den Report nie ein Input, bei
 *   Kapazitaets-Volumen aktiv schaedlich (siehe `buildK6Args`).
 *
 * `summaryPath` und `scriptPath` sind Pfade AUF dem Generator-Host. Die Werte
 * laufen unter Windows durch cmd.exe — deshalb keine Leerzeichen in
 * Remote-Pfaden (RUNBOOK, Zwei-Maschinen-Setup).
 *
 * @param {string} scriptPath
 * @param {{ runId: string, summaryPath: string, restAddress: string, env: NodeJS.ProcessEnv }} opts
 * @returns {string[]}
 */
export const buildRemoteK6Args = (
  scriptPath,
  { runId, summaryPath, restAddress, env },
) => {
  const args = [
    "run",
    "--address",
    restAddress,
    "--summary-export",
    summaryPath,
    "--tag",
    `test_run_id=${runId}`,
  ];
  for (const key of K6_SCRIPT_ENV_KEYS) {
    const value = env?.[key];
    if (value !== undefined && value !== "") args.push("-e", `${key}=${value}`);
  }
  args.push(scriptPath);
  return args;
};

/**
 * Spawn one k6 phase on the generator host via ssh. Der Exit-Code des
 * Remote-k6 wird von ssh durchgereicht und hier unveraendert aufgeloest —
 * `isExpectedK6Exit` bewertet ihn genau wie beim lokalen Lauf.
 *
 * Achtung Prozess-Identitaet: `child` ist der LOKALE ssh-Prozess. Ein
 * `child.kill()` beendet nur ssh; das Remote-k6 laeuft weiter und muss dann
 * auf dem Generator-Host beendet werden (`taskkill /F /IM k6.exe`, RUNBOOK).
 *
 * @param {string} scriptPath Pfad auf dem Generator-Host.
 * @param {{ runId: string, summaryPath: string, restAddress: string, env: NodeJS.ProcessEnv, sshHost: string, spawnImpl?: typeof spawn }} opts
 */
export const spawnK6Ssh = (
  scriptPath,
  { runId, summaryPath, restAddress, env, sshHost, spawnImpl = spawn },
) => {
  const args = buildRemoteK6Args(scriptPath, {
    runId,
    summaryPath,
    restAddress,
    env,
  });
  const child = spawnImpl("ssh", [sshHost, "k6", ...args], {
    stdio: "inherit",
  });
  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });
  return { child, exitPromise };
};

/**
 * Gracefully stop a running k6 via its REST API (`k6 run --address ...`).
 * Entspricht semantisch dem lokalen SIGINT: k6 faehrt die VUs herunter und
 * schreibt den `--summary-export`. Verifiziert mit k6 v2.0.0 (1-VU-Dummy):
 * Exit-Code 103 mit `msg="test run stopped from REST API"`, Summary
 * vollstaendig — der Code wird nach einem bewussten Stop nicht gegated,
 * nur in phase-a-meta.json festgehalten. Der Payload folgt dem
 * JSON:API-Format der k6-REST-API.
 *
 * @param {string} restUrl z.B. `http://192.168.1.30:6565`
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export const stopK6ViaRest = async (restUrl, opts = {}) => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${restUrl}/v1/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: { type: "status", id: "default", attributes: { stopped: true } },
    }),
  });
  if (!res.ok) {
    throw new Error(`k6 REST stop failed: PATCH ${restUrl}/v1/status -> ${res.status}`);
  }
};

/** Sum one metric family from a Prometheus text exposition, per event. */
const sumMetricLines = (text, metricName, eventId) => {
  let total = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith(metricName)) continue;
    if (line.includes("{") && eventId && !line.includes(eventId)) continue;
    const value = Number(line.slice(line.lastIndexOf(" ") + 1));
    if (Number.isFinite(value)) total = (total ?? 0) + value;
  }
  return total;
};

/** Read the monotonic `orders_completed_total` from the worker /metrics text. */
export const fetchCompletedCount = async (
  metricsUrl,
  eventId,
  fetchImpl = fetch,
) => {
  const res = await fetchImpl(metricsUrl);
  if (!res.ok) return null;
  return sumMetricLines(await res.text(), "orders_completed_total", eventId);
};

/**
 * Read `reservation_ledger_active` — the claims Redis still holds. Nur Laeufe
 * mit kurzer Checkout-Deadline brauchen das: dort gibt der Reaper abgelaufene
 * Ansprueche zurueck in den Verkauf, ein erschoepftes `available` allein heisst
 * also noch nicht, dass der Verkauf vorbei ist.
 */
export const fetchLedgerActive = async (
  metricsUrl,
  eventId,
  fetchImpl = fetch,
) => {
  const res = await fetchImpl(metricsUrl);
  if (!res.ok) return null;
  return sumMetricLines(await res.text(), "reservation_ledger_active", eventId);
};

/**
 * Classify a completion plateau against remaining inventory: only an exhausted
 * `available` counter is a genuine sell-out; a plateau with stock left is a stall
 * (host contention, generator saturation, wedged consumer).
 *
 * With `ledgerActive` supplied there is a third outcome. An exhausted
 * `available` while the ledger still holds claims is neither sold out nor
 * stalled: those claims are either about to be paid or about to be reaped, and
 * a reaped one goes back on sale. Stopping there would end the run with unsold
 * inventory and make exact sell-out unprovable, so it reports `ledger-pending`
 * and the caller keeps the load running.
 *
 * @param {number} available
 * @param {number | null} [ledgerActive]
 * @returns {"sold-out" | "stalled" | "ledger-pending"}
 */
export const classifyPlateau = (available, ledgerActive = null) => {
  if (available !== 0) return "stalled";
  if (ledgerActive !== null && ledgerActive > 0) return "ledger-pending";
  return "sold-out";
};

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
    readLedgerActive,
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
      let ledgerActive = null;
      if (readLedgerActive) {
        try {
          ledgerActive = await readLedgerActive(eventId);
        } catch {
          ledgerActive = null;
        }
      }
      // Without an inventory reading the plateau stays unclassified rather
      // than being asserted as a sell-out.
      const reason =
        available === null ? "stalled" : classifyPlateau(available, ledgerActive);

      // Ausverkauft, aber der Ledger haelt noch Ansprueche: die werden gleich
      // bezahlt oder gereapt, und ein gereapter geht zurueck in den Verkauf.
      // Hier zu stoppen wuerde den Lauf mit unverkauftem Inventar beenden.
      if (reason === "ledger-pending") {
        stalls = 0;
        continue;
      }

      return { stopped: true, reason, available, completed };
    }
  }

  return { stopped: false, reason: "k6-exited", available: null, completed: last };
};

// 105 (ExternalAbort) ist das Remote-Gegenstueck zum lokalen SIGINT-Stop:
// beide sind ein VON UNS ausgeloester gracefuler Stop, kein k6-Fehler.
export const isExpectedK6Exit = (code) =>
  code === 0 ||
  code === K6_THRESHOLD_FAILED_EXIT_CODE ||
  code === K6_EXTERNAL_ABORT_EXIT_CODE;

/**
 * Run phase A reactively; graceful stop once the completion counter plateaus.
 *
 * Der Stop-Kanal ist injizierbar (Zwei-Maschinen-Setup): lokal ist es das
 * bewaehrte SIGINT an den k6-Prozess, remote der REST-Stop — beide enden in
 * einem gracefulen Shutdown inkl. `--summary-export`. `spawnPhase` erlaubt
 * denselben Tausch fuer den Prozessstart (`spawnK6` vs. `spawnK6Ssh`).
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
  readLedgerActive,
  gracefulStopTimeoutMs = 40_000,
  spawnPhase = spawnK6,
  requestStop,
  fetchImpl = fetch,
}) => {
  const { child, exitPromise } = spawnPhase(scriptPath, {
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
    readLedgerActive,
    fetchImpl,
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

  const stopGracefully = requestStop ?? (() => child.kill("SIGINT"));
  try {
    await stopGracefully();
  } catch {
    // REST-Stop nicht zustellbar (Netz weg, k6 schon beendet): es gibt keinen
    // zweiten Kanal — unten greift der Timeout mit SIGKILL-Fallback.
  }
  const race = await Promise.race([
    exitPromise.then((code) => ({ status: "exited", code })),
    sleep(gracefulStopTimeoutMs).then(() => ({ status: "timeout" })),
  ]);
  if (race.status === "timeout") {
    // Remote trifft das nur den lokalen ssh-Prozess; ein weiterlaufendes k6
    // muss auf dem Generator-Host beendet werden: `taskkill /F /IM k6.exe`
    // (RUNBOOK, Zwei-Maschinen-Setup).
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
export const runPhaseB = async ({
  scriptPath,
  runId,
  summaryPath,
  env,
  spawnPhase = spawnK6,
}) => {
  const { exitPromise } = spawnPhase(scriptPath, { runId, summaryPath, env });
  return exitPromise;
};
