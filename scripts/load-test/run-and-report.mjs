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
 * This is the side-effecting layer: it requires the local cluster (API and
 * worker pods in kind, Prometheus scraping each pod, ADR-047), the Compose
 * datastores and k6. Every service metric comes from Prometheus, because a
 * Service URL answers from one arbitrary pod. The pure analysis it delegates
 * to is exercised by the unit + golden tests without any of that.
 *
 * Usage: node scripts/load-test/run-and-report.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";

import {
  loadPolicy,
  getGitInfo,
  getHostInfo,
  preflight,
  REPO_ROOT,
} from "./lib/config.mjs";
import { buildManifest, redactConfig } from "./lib/manifest.mjs";
import {
  readAvailableTickets,
  snapshotPostgres,
  snapshotRedis,
} from "./lib/snapshots.mjs";
import {
  countTargetsUp,
  instantQuery,
  readEventCounter,
  readLedgerActive,
  SCRAPE_INTERVAL_MS,
  snapshotJob,
  targetUp,
  waitForFreshScrape,
} from "./lib/prometheus.mjs";
import {
  assessCluster,
  MEASURED_DEPLOYMENTS,
  readDeployments,
} from "./lib/cluster.mjs";
import { waitForDrain } from "./lib/drain.mjs";
import {
  runPhaseAReactive,
  runPhaseB,
  spawnK6Ssh,
  stopK6ViaRest,
} from "./lib/processes.mjs";
import { exportDashboards } from "./lib/grafana.mjs";
import { analyzeAndWrite } from "./analyze-run.mjs";
import { requireEnv, requireEnvBoolean } from "../lib/require-env.mjs";

const EVENT_ID = requireEnv("EVENT_ID");
const BASE_URL = requireEnv("BASE_URL");
const K8S_CONTEXT = requireEnv("K8S_CONTEXT");
const PROMETHEUS_URL = requireEnv("PROMETHEUS_URL");
const SALE_OPENS_IN_SECONDS = requireEnv("SALE_OPENS_IN_SECONDS");

// Zwei-Maschinen-Setup (Phase 4.12): `local` startet k6 wie bisher auf diesem
// Host, `ssh` auf dem Generator-PC. Die drei Split-Werte kommen bewusst NICHT
// aus dem versionierten Profil (Heimnetz-IPs gehoeren nicht ins Repo), sondern
// inline mit dem Startbefehl — Node laesst bereits gesetztes Prozess-Env vor
// `--env-file` gewinnen (RUNBOOK §4).
const K6_RUNNER = requireEnv("K6_RUNNER");
if (K6_RUNNER !== "local" && K6_RUNNER !== "ssh") {
  throw new Error(
    `K6_RUNNER muss "local" oder "ssh" sein, ist aber "${K6_RUNNER}"`,
  );
}
const REMOTE =
  K6_RUNNER === "ssh"
    ? {
        sshHost: requireEnv("K6_SSH_HOST", "z.B. loadgen bzw. user@<pc-ip>"),
        remoteDir: requireEnv(
          "K6_REMOTE_DIR",
          "Repo-Klon auf dem Generator-Host, Pfad ohne Leerzeichen, z.B. C:/hfts",
        ),
        restUrl: requireEnv(
          "K6_REST_URL",
          "k6-REST-API auf dem Generator-Host, z.B. http://<pc-ip>:6565",
        ),
      }
    : null;
// k6 lauscht auf allen Interfaces des Generator-Hosts, damit der Orchestrator
// den Sold-out-Stop ueber das LAN zustellen kann; der Port folgt K6_REST_URL.
const REST_ADDRESS = REMOTE
  ? `0.0.0.0:${new URL(REMOTE.restUrl).port || "6565"}`
  : null;

/** Repo-relativer Pfad einer lokalen Datei im Remote-Klon (forward slashes —
 * die Kommandos laufen auf Windows durch cmd.exe). */
const toRemotePath = (localPath) =>
  `${REMOTE.remoteDir}/${relative(REPO_ROOT, localPath).split(sep).join("/")}`;

/** Die Remote-Summary landet flach im Klon-Root: der Run-Ordner existiert nur
 * lokal, und cmd.exe-sicheres rekursives mkdir ist den Aufwand nicht wert —
 * die Datei wird direkt nach Phasen-Ende per scp an den exakt lokalen Pfad
 * geholt und remote beim naechsten Lauf ueberschrieben. */
const remoteSummaryPath = (localSummaryPath) =>
  `${REMOTE.remoteDir}/${basename(localSummaryPath)}`;

const fetchRemoteSummary = (localSummaryPath) => {
  execFileSync(
    "scp",
    [`${REMOTE.sshHost}:${remoteSummaryPath(localSummaryPath)}`, localSummaryPath],
    { stdio: "inherit" },
  );
};

// Prozessstart und Stop-Kanal je Runner; `undefined` laesst die lokalen
// Defaults (spawnK6, SIGINT) in processes.mjs greifen.
const spawnPhase = REMOTE
  ? (scriptPath, { runId, summaryPath, env, logPath }) =>
      spawnK6Ssh(toRemotePath(scriptPath), {
        runId,
        summaryPath: remoteSummaryPath(summaryPath),
        restAddress: REST_ADDRESS,
        env,
        sshHost: REMOTE.sshHost,
        logPath,
      })
  : undefined;
const requestStop = REMOTE ? () => stopK6ViaRest(REMOTE.restUrl) : undefined;
/** Vorlauf/Nachlauf der exportierten Panels: Ruhelinie vor, Leerlaufen nach dem Ansturm. */
const GRAPH_PAD_BEFORE_MS = 60_000;
const GRAPH_PAD_AFTER_MS = 30_000;

const nowIso = () => new Date().toISOString();
const stamp = () => nowIso().replace(/[:.]/g, "-");

/** A counter summed over every pod of a job; absent series count as 0. */
const sumOverPods = async (job, metric) =>
  (await instantQuery(PROMETHEUS_URL, `sum(${metric}{job="${job}"})`)).value ?? 0;

/**
 * Read the drain-relevant counters: `published` from the API (confirmed
 * payments — the point at which a message actually reaches Pub/Sub, ADR-028),
 * `completed`/`failed` from the worker.
 *
 * Deliberately NOT `orders_accepted_total`: that increments at reserve time, so
 * cancelled and abandoned checkouts would count as an eternal backlog and the
 * drain could never reach zero (see lib/drain.mjs).
 */
const fetchCounters = async () => ({
  published: await sumOverPods("api", "payments_confirmed_total"),
  completed: await sumOverPods("worker", "orders_completed_total"),
  failed: await sumOverPods("worker", "orders_failed_total"),
});

/**
 * Are the pods under test ready, scraped, and reachable through the gateway?
 * Runs before the reset, so a missing pod aborts the run while database, Redis
 * and TSDB are still untouched.
 *
 * @returns {Promise<string[]>} problems
 */
const checkCluster = async () => {
  let deployments;
  let targetsUp;
  try {
    deployments = readDeployments(K8S_CONTEXT, MEASURED_DEPLOYMENTS);
  } catch (error) {
    return [
      `kubectl --context ${K8S_CONTEXT} get deployment failed (${error instanceof Error ? error.message.split("\n")[0] : error}) — cluster up? \`pnpm kind:up\``,
    ];
  }
  try {
    targetsUp = Object.fromEntries(
      await Promise.all(
        MEASURED_DEPLOYMENTS.map(async (job) => [
          job,
          await countTargetsUp(PROMETHEUS_URL, job),
        ]),
      ),
    );
  } catch (error) {
    return [
      `Prometheus unreachable at ${PROMETHEUS_URL} (${error instanceof Error ? error.message : error}) — \`kubectl --context ${K8S_CONTEXT} get pods -l app=prometheus\``,
    ];
  }
  const problems = assessCluster({
    deployments,
    targetsUp,
    expectedProfile: requireEnv("HFTS_ENV"),
  });

  // Any HTTP answer proves the path Envoy → API; a 404 for a not yet seeded
  // event is fine, the reset seeds it. Only a 5xx or no answer is a problem.
  const gatewayUrl = `${BASE_URL}/api/tickets/${EVENT_ID}/availability`;
  try {
    const res = await fetch(gatewayUrl, { signal: AbortSignal.timeout(3000) });
    if (res.status >= 500) {
      problems.push(`Gateway answered ${res.status} at ${gatewayUrl}.`);
    }
  } catch (error) {
    problems.push(
      `Gateway unreachable at ${gatewayUrl} (${error instanceof Error ? error.message : error}) — kind port mapping 10000, \`kubectl --context ${K8S_CONTEXT} get gateway\`.`,
    );
  }
  return problems;
};

const main = async () => {
  const policy = loadPolicy();

  // 1. Preflight — fail before mutating any state. Tools + containers first,
  // then the services under test: they are host processes, so running containers
  // say nothing about them. Both gates run BEFORE the seed, because the seed
  // truncates the database and wipes the Prometheus TSDB.
  //
  // Beim ssh-Runner braucht DIESER Host kein k6 — dafuer ssh, und das k6 auf
  // dem Generator-Host muss zur lokal gepinnten Major-Version (v2.x) passen.
  const pf = preflight({
    requiredCommands: REMOTE
      ? ["node", "pnpm", "ssh", "kubectl"]
      : ["node", "pnpm", "k6", "kubectl"],
  });
  if (!pf.ok) {
    console.error("[spike:report] Preflight failed:");
    for (const problem of pf.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  if (REMOTE) {
    let remoteK6Version = "";
    try {
      remoteK6Version = execFileSync(
        "ssh",
        [REMOTE.sshHost, "k6", "--version"],
        { encoding: "utf8" },
      ).trim();
    } catch (error) {
      console.error(
        `[spike:report] Preflight failed: \`ssh ${REMOTE.sshHost} k6 --version\` — ${error instanceof Error ? error.message : error}`,
      );
      console.error(
        "  - Generator-Host erreichbar, OpenSSH-Server + k6 installiert? (RUNBOOK, Zwei-Maschinen-Setup)",
      );
      process.exit(1);
    }
    if (!/\bv2\./.test(remoteK6Version)) {
      console.error(
        `[spike:report] Preflight failed: Remote-k6 ist "${remoteK6Version}", erwartet v2.x (Pin an die lokale Version).`,
      );
      process.exit(1);
    }
    console.log(`[spike:report] Remote k6 (${REMOTE.sshHost}): ${remoteK6Version}`);
  }

  const clusterProblems = await checkCluster();
  if (clusterProblems.length > 0) {
    console.error(
      "[spike:report] Preflight failed — the cluster is not ready to be measured. Nothing was seeded or reset:",
    );
    for (const problem of clusterProblems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  // 2. Manifest identity.
  const git = getGitInfo();
  const runId = `${stamp()}-${git.commit.slice(0, 7)}`;
  // Belege behaelt nur, wer sie auswertet. Der Smoke-Lauf prueft die Messkette
  // und interessiert sich ausschliesslich fuer das Urteil auf der Konsole —
  // seine Rohdaten landen im Temp-Verzeichnis und verschwinden mit dem Host.
  const saveArtifacts = requireEnvBoolean("SAVE_ARTIFACTS");
  const runDir = saveArtifacts
    ? join(REPO_ROOT, "artifacts", "load-tests", runId)
    : join(mkdtempSync(join(tmpdir(), "hfts-spike-")), runId);
  for (const sub of ["k6", "metrics", "state"]) {
    mkdirSync(join(runDir, sub), { recursive: true });
  }
  const timestamps = { seededAt: null };

  const k6Env = {
    ...process.env,
    BASE_URL,
    EVENT_ID,
    K6_PROMETHEUS_RW_SERVER_URL: requireEnv("K6_PROMETHEUS_RW_SERVER_URL"),
  };

  // 3. Zustands-Reset — bewusst hier und nicht beim Hochfahren des Stacks:
  // `opensAt` wird als `Date.now() + SALE_OPENS_IN_SECONDS` geschrieben und
  // waere bis zum Lastbeginn laengst verfallen, wenn der Stack Minuten vorher
  // gestartet wurde. Die Provisionierung (Schema, Topic, Subscription) ist
  // bereits gelaufen; sie gehoert vor die Services.
  console.log("[spike:report] Resetting run state...");
  execFileSync("node", [join(REPO_ROOT, "scripts", "local", "reset.mjs")], {
    stdio: "inherit",
    env: { ...process.env, SALE_OPENS_IN_SECONDS },
  });
  timestamps.seededAt = nowIso();

  // 4. Baseline snapshots (state survives across the run for counter deltas).
  // The reset emptied the TSDB; until every pod was scraped again a snapshot
  // would record an empty baseline.
  await waitForFreshScrape({
    baseUrl: PROMETHEUS_URL,
    jobs: MEASURED_DEPLOYMENTS,
    sinceMs: Date.parse(timestamps.seededAt),
  });
  const stateBefore = {
    postgres: snapshotPostgres(EVENT_ID),
    redis: snapshotRedis(EVENT_ID),
  };
  const apiBefore = await snapshotJob(PROMETHEUS_URL, "api");
  const workerBefore = await snapshotJob(PROMETHEUS_URL, "worker");
  const drainBaseline = await fetchCounters();
  writeFileSync(join(runDir, "metrics", "api-before.prom"), apiBefore.text);
  writeFileSync(join(runDir, "metrics", "worker-before.prom"), workerBefore.text);
  writeFileSync(
    join(runDir, "state", "before.json"),
    JSON.stringify(stateBefore, null, 2) + "\n",
  );

  // 5. Phase A (reactive) + phase B.
  timestamps.workloadStartedAt = nowIso();
  const phaseA = await runPhaseAReactive({
    scriptPath: join(REPO_ROOT, "load-tests", "spike-phase-a.js"),
    runId,
    summaryPath: join(runDir, "k6", "phase-a-summary.json"),
    env: k6Env,
    // Sold-out-Quelle (ADR-025) ueber alle Worker-Pods. Gepollt wird im
    // Scrape-Takt: schneller gelesen, sieht der Detektor denselben Scrape
    // zweimal und haelt das fuer ein Plateau.
    readCompleted: (eventId) =>
      readEventCounter(PROMETHEUS_URL, "orders_completed_total", eventId),
    pollIntervalMs: SCRAPE_INTERVAL_MS,
    eventId: EVENT_ID,
    // Lets the plateau detector tell a real sell-out from host contention.
    readAvailable: (eventId) => readAvailableTickets(eventId),
    // Immer gelesen: zusammen mit `available == 0` ist ein leerer Ledger der
    // eindeutige Beleg, dass der Verkauf entschieden ist — dann bricht Phase A
    // sofort ab, ohne erst ein Completion-Plateau abzuwarten.
    readLedgerActive: (eventId) => readLedgerActive(PROMETHEUS_URL, eventId),
    // Fuer die Plateau-Erkennung gilt weiter Ablauf-Semantik statt Profilname:
    // ist die Checkout-Deadline kurz genug, um innerhalb des Phase-A-Fensters
    // (max ~990 s) abzulaufen, gibt der Reaper Ansprueche zurueck in den
    // Verkauf — ein Stopp bei `available == 0` wuerde den Lauf dann mit
    // unverkauftem Inventar beenden. Bei langer Deadline (900 s) wuerde
    // dieselbe Bedingung nie greifen und der Lauf ins 15-min-Sicherheitsnetz
    // laufen.
    plateauWaitsForEmptyLedger:
      Number(requireEnv("CHECKOUT_PENDING_TIMEOUT_SECONDS")) <= 600,
    spawnPhase,
    requestStop,
    // k6-Konsole (Insufficient VUs, dial-Fehler, Thresholds) als Beleg.
    logPath: join(runDir, "k6", "phase-a.log"),
  });
  const phaseAExit = phaseA.exitCode;
  timestamps.phaseAEndedAt = nowIso();
  // Split-Lauf: die Summary liegt noch auf dem Generator-Host — sofort an den
  // exakt heutigen lokalen Pfad holen, damit summarisePhase und die Goldens
  // nichts vom Remote-Setup merken.
  if (REMOTE) fetchRemoteSummary(join(runDir, "k6", "phase-a-summary.json"));
  if (phaseA.stopReason === "stalled") {
    console.warn(
      `[spike:report] Phase A stopped on a completion plateau with ${phaseA.availableAtStop ?? "unknown"} tickets still available — this is NOT a sell-out.`,
    );
  }
  writeFileSync(
    join(runDir, "k6", "phase-a-meta.json"),
    JSON.stringify({
      exitCode: phaseAExit,
      reason: "reactive-phase-a",
      stopReason: phaseA.stopReason,
      availableAtStop: phaseA.availableAtStop,
    }) + "\n",
  );

  const phaseBExit = await runPhaseB({
    scriptPath: join(REPO_ROOT, "load-tests", "spike-phase-b.js"),
    runId,
    summaryPath: join(runDir, "k6", "phase-b-summary.json"),
    env: k6Env,
    spawnPhase,
    logPath: join(runDir, "k6", "phase-b.log"),
  });
  timestamps.workloadEndedAt = nowIso();
  if (REMOTE) fetchRemoteSummary(join(runDir, "k6", "phase-b-summary.json"));
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
  const apiAfter = await snapshotJob(PROMETHEUS_URL, "api");
  const workerAfter = await snapshotJob(PROMETHEUS_URL, "worker");
  writeFileSync(join(runDir, "metrics", "api-after.prom"), apiAfter.text);
  writeFileSync(join(runDir, "metrics", "worker-after.prom"), workerAfter.text);
  writeFileSync(
    join(runDir, "state", "after.json"),
    JSON.stringify(stateAfter, null, 2) + "\n",
  );

  // Counter deltas are only valid while the same pods live from snapshot to
  // snapshot: a restarted pod starts its counters at 0 again.
  const pods = {
    before: { api: apiBefore.instances, worker: workerBefore.instances },
    after: { api: apiAfter.instances, worker: workerAfter.instances },
  };
  const podsChanged =
    JSON.stringify(pods.before) !== JSON.stringify(pods.after);
  if (podsChanged) {
    console.warn(
      `[spike:report] Pods changed during the run (before ${JSON.stringify(pods.before)}, after ${JSON.stringify(pods.after)}) — counter deltas of a restarted pod are wrong.`,
    );
  }
  const health = {
    apiUp: await targetUp(PROMETHEUS_URL, "api").catch(() => null),
    workerUp: await targetUp(PROMETHEUS_URL, "worker").catch(() => null),
    scrapeGapSeconds: null,
    pods,
    podsChanged,
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

  // 9b. Grafana panels as PNG for exactly this run's window (ADR-030).
  // Best-effort on purpose: the numeric evidence is already on disk, and a
  // missing renderer container must not turn a valid run into a failed one.
  if (requireEnvBoolean("EXPORT_GRAPHS")) {
    const from = Date.parse(timestamps.workloadStartedAt) - GRAPH_PAD_BEFORE_MS;
    const to =
      Date.parse(timestamps.drainEndedAt ?? timestamps.workloadEndedAt) +
      GRAPH_PAD_AFTER_MS;
    console.log("[spike:report] Exporting Grafana panels...");
    try {
      const graphs = await exportDashboards({
        outDir: join(runDir, "grafana"),
        from: String(from),
        to: String(to),
        log: (message) => console.log(message),
      });
      console.log(
        `[spike:report] Grafana: ${graphs.written}/${graphs.total} panels -> ${graphs.outDir}`,
      );
      for (const f of graphs.failed) {
        console.warn(`[spike:report]   panel failed: ${f.dashboard} / ${f.panel}: ${f.error}`);
      }
    } catch (error) {
      console.warn(
        `[spike:report] Grafana export skipped: ${error instanceof Error ? error.message : error}`,
      );
      console.warn(
        `[spike:report]   Renderer running? \`kubectl --context ${K8S_CONTEXT} get pods -l app=renderer\`. Nachtraeglich: \`pnpm spike:graphs\`.`,
      );
    }
  }

  console.log(
    saveArtifacts
      ? `[spike:report] Artifacts: ${runDir}`
      : `[spike:report] Artifacts: verworfen (SAVE_ARTIFACTS=false), temporaer unter ${runDir}`,
  );
  console.log(
    `[spike:report] benchmark=${derived.validity.benchmark.verdict} system=${derived.validity.system.verdict} performance=${derived.validity.performance.verdict} (k6 phaseA=${phaseAExit} phaseB=${phaseBExit})`,
  );

  // 10. Policy exit code — only after every artifact has been written.
  process.exit(derived.validity.system.verdict === "fail" ? 1 : 0);
};

main().catch((error) => {
  console.error("[spike:report] Failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
