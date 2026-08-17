import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildK6Args,
  buildRemoteK6Args,
  classifyPlateau,
  fetchCompletedCount,
  isExpectedK6Exit,
  K6_SCRIPT_ENV_KEYS,
  pollUntilSoldOut,
  runPhaseAReactive,
  spawnK6Ssh,
  stopK6ViaRest,
} from "../lib/processes.mjs";

// --- k6 argv / Prometheus remote-write default ---

// Regression for Baseline B (report §4.1): k6's remote-write drove Prometheus to
// 5.5 GiB and a 503, destroying the health facts and peak queries the report
// actually needs. It is never a report input, so it must be opt-in.
test("k6 runs without Prometheus remote-write by default", () => {
  const args = buildK6Args("phase-a.js", {
    runId: "r1",
    summaryPath: "s.json",
  });
  assert.ok(!args.includes("--out"), `unexpected --out in ${args.join(" ")}`);
  assert.ok(args.includes("--summary-export"));
});

test("remote-write can be opted into explicitly", () => {
  const args = buildK6Args("phase-a.js", {
    runId: "r1",
    summaryPath: "s.json",
    prometheusRw: true,
  });
  assert.deepEqual(args.slice(0, 3), [
    "run",
    "--out",
    "experimental-prometheus-rw",
  ]);
});

test("isExpectedK6Exit treats a threshold failure as a result, not a crash", () => {
  assert.equal(isExpectedK6Exit(0), true);
  assert.equal(isExpectedK6Exit(99), true);
  assert.equal(isExpectedK6Exit(1), false);
});

// --- Remote-Runner (Zwei-Maschinen-Setup, Phase 4.12) ---

// 105 = ExternalAbort: ein von aussen ausgeloester gracefuler Stop ist ein
// Ergebnis, kein Crash. Der REST-Stop selbst liefert auf k6 v2.0.0 empirisch
// 103 — das bleibt hier bewusst unerwartet: `isExpectedK6Exit` bewertet nur
// Laeufe, die OHNE unseren Stop endeten, und dort ist 103 ein Engine-Fehler.
// Nach einem bewussten Stop wird der Exit-Code gar nicht gegated.
test("isExpectedK6Exit accepts ExternalAbort but not engine errors", () => {
  assert.equal(isExpectedK6Exit(105), true);
  assert.equal(isExpectedK6Exit(103), false);
  assert.equal(isExpectedK6Exit(107), false);
  assert.equal(isExpectedK6Exit(108), false);
});

// ssh reicht das Prozess-Env nicht weiter — jeder Wert, den die k6-Skripte
// per requireEnv* lesen, MUSS als `-e`-Flag mitfahren. Der Abgleich laeuft
// gegen die Quelle selbst, damit ein neuer Skript-Knopf hier nicht still
// fehlt und der Remote-Lauf erst auf dem PC stirbt.
test("K6_SCRIPT_ENV_KEYS covers every requireEnv* call in scenario-helpers", () => {
  const source = readFileSync(
    new URL("../../../load-tests/lib/scenario-helpers.js", import.meta.url),
    "utf8",
  );
  const required = [
    ...source.matchAll(/requireEnv(?:Number|Boolean)?\("([A-Z0-9_]+)"\)/g),
  ].map((m) => m[1]);
  assert.ok(required.length > 0, "no requireEnv* calls found — parser broken?");
  for (const key of required) {
    assert.ok(
      K6_SCRIPT_ENV_KEYS.includes(key),
      `scenario-helpers.js requires ${key}, but K6_SCRIPT_ENV_KEYS misses it`,
    );
  }
});

const remoteEnv = () => ({
  BASE_URL: "http://192.168.1.20:10002",
  EVENT_ID: "e-1",
  LOAD_PROFILE: "capacity",
  CHECKOUT_SHARE: "0.4",
  PAY_RATE: "0.88",
  CANCEL_RATE: "0.08",
  THINK_TIME_KIND: "none",
  THINK_TIME_MIN: "0",
  THINK_TIME_MAX: "0",
  THINK_TIME_MEAN: "0",
  THINK_TIME_SIGMA: "0",
  CHECKOUT_POLL: "false",
  CHECKOUT_POLL_MAX_ATTEMPTS: "10",
  CHECKOUT_POLL_INTERVAL: "1",
  HTS_ENV_PROFILE: "capacity",
});

test("buildRemoteK6Args passes every set contract key as -e flag", () => {
  const env = remoteEnv();
  const args = buildRemoteK6Args("C:/hts/load-tests/spike-phase-a.js", {
    runId: "r1",
    summaryPath: "C:/hts/artifacts/phase-a-summary.json",
    restAddress: "0.0.0.0:6565",
    env,
  });
  assert.deepEqual(args.slice(0, 3), ["run", "--address", "0.0.0.0:6565"]);
  assert.equal(args.at(-1), "C:/hts/load-tests/spike-phase-a.js");
  assert.ok(!args.includes("--out"), "remote-write darf nie mitfahren");
  for (const [key, value] of Object.entries(env)) {
    const flagIndex = args.indexOf(`${key}=${value}`);
    assert.ok(flagIndex > 0, `missing -e ${key}=${value}`);
    assert.equal(args[flagIndex - 1], "-e");
  }
});

test("buildRemoteK6Args skips unset keys instead of sending empty values", () => {
  const args = buildRemoteK6Args("phase-a.js", {
    runId: "r1",
    summaryPath: "s.json",
    restAddress: "0.0.0.0:6565",
    env: { BASE_URL: "http://x", HTS_ENV_PROFILE: "" },
  });
  assert.ok(args.includes("BASE_URL=http://x"));
  assert.ok(!args.some((a) => a.startsWith("HTS_ENV_PROFILE=")));
});

test("spawnK6Ssh runs k6 on the ssh host and passes the exit code through", async () => {
  const calls = [];
  const fakeChild = {
    handlers: {},
    on(event, cb) {
      this.handlers[event] = cb;
    },
  };
  const { exitPromise } = spawnK6Ssh("C:/hts/load-tests/spike-phase-a.js", {
    runId: "r1",
    summaryPath: "C:/hts/summary.json",
    restAddress: "0.0.0.0:6565",
    env: { BASE_URL: "http://x" },
    sshHost: "loadgen",
    spawnImpl: (cmd, args) => {
      calls.push({ cmd, args });
      return fakeChild;
    },
  });
  assert.equal(calls[0].cmd, "ssh");
  assert.deepEqual(calls[0].args.slice(0, 2), ["loadgen", "k6"]);
  assert.equal(calls[0].args.at(-1), "C:/hts/load-tests/spike-phase-a.js");
  fakeChild.handlers.exit(105);
  assert.equal(await exitPromise, 105);
});

test("stopK6ViaRest PATCHes the JSON:API stop payload", async () => {
  const calls = [];
  await stopK6ViaRest("http://192.168.1.30:6565", {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    },
  });
  assert.equal(calls[0].url, "http://192.168.1.30:6565/v1/status");
  assert.equal(calls[0].init.method, "PATCH");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.data.attributes.stopped, true);
  assert.equal(body.data.type, "status");
});

test("stopK6ViaRest throws on a non-2xx answer", async () => {
  await assert.rejects(
    stopK6ViaRest("http://x:6565", {
      fetchImpl: async () => ({ ok: false, status: 404 }),
    }),
    /404/,
  );
});

// Stopper-Injection: remote wird das Plateau per REST gestoppt, nicht per
// Signal — child.kill traefe nur den lokalen ssh-Prozess, nie das k6. Der
// Exit-Code 103 hier ist der real beobachtete REST-Stop-Code (k6 v2.0.0);
// nach einem bewussten Stop darf er nicht als operationaler Fehler werfen.
test("runPhaseAReactive uses the injected stopper instead of SIGINT", async () => {
  const kills = [];
  let stopRequested = false;
  let resolveExit;
  const exitPromise = new Promise((r) => {
    resolveExit = r;
  });
  const result = await runPhaseAReactive({
    scriptPath: "phase-a.js",
    runId: "r1",
    summaryPath: "s.json",
    env: {},
    metricsUrl: "http://x/metrics",
    eventId: "e-1",
    pollIntervalMs: 1,
    confirmPolls: 2,
    readAvailable: async () => 0,
    fetchImpl: metricsSequence([1, 5, 5, 5, 5]),
    spawnPhase: () => ({
      child: { kill: (signal) => kills.push(signal) },
      exitPromise,
    }),
    requestStop: async () => {
      stopRequested = true;
      resolveExit(103);
    },
  });
  assert.equal(stopRequested, true);
  assert.deepEqual(kills, [], "kein Signal an den (ssh-)Prozess erwartet");
  assert.equal(result.exitCode, 103);
  assert.equal(result.stopReason, "sold-out");
});

// --- Plateau classification ---

test("classifyPlateau only calls exhausted inventory a sell-out", () => {
  assert.equal(classifyPlateau(0), "sold-out");
  assert.equal(classifyPlateau(1), "stalled");
  assert.equal(classifyPlateau(89_359), "stalled");
});

// Phase 4.10: im Funnel-Profil gibt der Reaper abgelaufene Ansprueche zurueck
// in den Verkauf. `available == 0` bei nicht leerem Ledger ist deshalb weder
// ausverkauft noch stehengeblieben — der Lauf muss weiterkaufen.
test("classifyPlateau waits for the ledger to drain before declaring sell-out", () => {
  assert.equal(classifyPlateau(0, 0), "sold-out");
  assert.equal(classifyPlateau(0, 12), "ledger-pending");
  // Ohne Ledger-Messung bleibt das Verhalten wie bisher.
  assert.equal(classifyPlateau(0, null), "sold-out");
  // Ein nicht leerer Ledger macht aus einem Stall keinen Sonderfall.
  assert.equal(classifyPlateau(500, 12), "stalled");
});

/** Serve a scripted sequence of `orders_completed_total` values. */
const metricsSequence = (values) => {
  let i = 0;
  return async () => ({
    ok: true,
    text: async () =>
      `orders_completed_total ${values[Math.min(i++, values.length - 1)]}\n`,
  });
};

test("fetchCompletedCount sums the counter from /metrics text", async () => {
  const total = await fetchCompletedCount(
    "http://x/metrics",
    undefined,
    metricsSequence([42]),
  );
  assert.equal(total, 42);
});

test("fetchCompletedCount returns null on a failed scrape", async () => {
  const total = await fetchCompletedCount("http://x/metrics", undefined, async () => ({
    ok: false,
  }));
  assert.equal(total, null);
});

// The core Baseline-B regression (report §4.5): phase A stopped at 888s of 990s
// while 89 359 tickets were still available, and the run was treated as a
// sell-out. A plateau with inventory left must be reported as a stall.
test("a completion plateau with inventory left is a stall, not a sell-out", async () => {
  const never = new Promise(() => {});
  const result = await pollUntilSoldOut(never, {
    metricsUrl: "http://x/metrics",
    eventId: "e-1",
    pollIntervalMs: 1,
    confirmPolls: 2,
    readAvailable: async () => 89_359,
    fetchImpl: metricsSequence([1, 5, 5, 5, 5]),
  });
  assert.equal(result.stopped, true);
  assert.equal(result.reason, "stalled");
  assert.equal(result.available, 89_359);
});

test("a completion plateau at zero inventory is a real sell-out", async () => {
  const never = new Promise(() => {});
  const result = await pollUntilSoldOut(never, {
    metricsUrl: "http://x/metrics",
    eventId: "e-1",
    pollIntervalMs: 1,
    confirmPolls: 2,
    readAvailable: async () => 0,
    fetchImpl: metricsSequence([1, 5, 5, 5, 5]),
  });
  assert.equal(result.reason, "sold-out");
  assert.equal(result.available, 0);
});

// Der eigentliche Funnel-Fall: erst haelt der Ledger noch Ansprueche (der Lauf
// muss weiterlaufen), dann sind sie weg und derselbe Detektor stoppt.
test("a plateau at zero inventory keeps running until the ledger is empty", async () => {
  const never = new Promise(() => {});
  const ledgerReadings = [7, 7, 0];
  let read = 0;
  const result = await pollUntilSoldOut(never, {
    metricsUrl: "http://x/metrics",
    eventId: "e-1",
    pollIntervalMs: 1,
    confirmPolls: 2,
    readAvailable: async () => 0,
    readLedgerActive: async () =>
      ledgerReadings[Math.min(read++, ledgerReadings.length - 1)],
    fetchImpl: metricsSequence([1, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
  });
  assert.equal(result.reason, "sold-out");
  assert.equal(result.available, 0);
  assert.ok(
    read >= 3,
    `expected the ledger to be polled until empty, saw ${String(read)} reads`,
  );
});

// Without an inventory reading the detector must not upgrade a plateau to a
// sell-out it cannot prove.
test("an unreadable inventory leaves the plateau unclassified (stalled)", async () => {
  const never = new Promise(() => {});
  const result = await pollUntilSoldOut(never, {
    metricsUrl: "http://x/metrics",
    eventId: "e-1",
    pollIntervalMs: 1,
    confirmPolls: 2,
    readAvailable: async () => {
      throw new Error("redis-cli unavailable");
    },
    fetchImpl: metricsSequence([1, 5, 5, 5, 5]),
  });
  assert.equal(result.reason, "stalled");
  assert.equal(result.available, null);
});
