#!/usr/bin/env node
/**
 * `spike:graphs` — export every Grafana panel als PNG für einen Zeitraum.
 *
 * Ersetzt das manuelle Screenshot-Sammeln: Grafana rendert serverseitig
 * (`grafana-image-renderer`), jedes Panel kommt mit Titel und Legende als
 * eigene Datei ins Run-Verzeichnis (ADR-030).
 *
 * Beispiele:
 *   pnpm spike:graphs                                   # letzter Run, Fenster aus dessen manifest.json
 *   pnpm spike:graphs --range '{"from":"2026-07-27 16:19:00","to":"2026-07-27 16:31:00"}'
 *   pnpm spike:graphs --from "2026-07-27 16:19:00" --to "2026-07-27 16:31:00" --out /tmp/graphs
 *   pnpm spike:graphs --run 2026-07-27T14-18-37-924Z-b776eb5 --from now-30m --to now
 *
 * Zeiten ohne Zonenangabe werden in `--tz` (Default Europe/Vienna) gelesen —
 * genau so, wie die Grafana-Zeitauswahl sie ausgibt.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./lib/config.mjs";
import { exportDashboards, parseRangeJson } from "./lib/grafana.mjs";

const RUNS_DIR = join(REPO_ROOT, "artifacts", "load-tests");

/** @param {string[]} argv */
const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unbekanntes Argument: ${arg}`);
    const [flag, inline] = arg.slice(2).split(/=(.*)/s);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`--${flag} braucht einen Wert`);
    out[flag] = value;
  }
  return out;
};

/** Jüngstes Run-Verzeichnis (die Run-IDs sortieren lexikografisch = chronologisch). */
const latestRunDir = () => {
  if (!existsSync(RUNS_DIR)) return null;
  const dirs = readdirSync(RUNS_DIR)
    .map((name) => join(RUNS_DIR, name))
    .filter((path) => statSync(path).isDirectory())
    .sort();
  return dirs.at(-1) ?? null;
};

/**
 * Fenster eines Runs aus dessen manifest.json: vom Workload-Start bis zum Ende
 * des Drains, mit Puffer — der Vorlauf zeigt die Ruhelinie vor dem Ansturm, der
 * Nachlauf das Leerlaufen der Queue.
 */
const windowFromManifest = (runDir, padBeforeSeconds, padAfterSeconds) => {
  const manifestPath = join(runDir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  const { timestamps } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const start = timestamps?.workloadStartedAt ?? timestamps?.seededAt;
  const end =
    timestamps?.drainEndedAt ??
    timestamps?.workloadEndedAt ??
    timestamps?.phaseAEndedAt;
  if (!start || !end) return null;
  return {
    from: String(Date.parse(start) - padBeforeSeconds * 1000),
    to: String(Date.parse(end) + padAfterSeconds * 1000),
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  const runDir = args.run
    ? args.run.includes("/")
      ? args.run
      : join(RUNS_DIR, args.run)
    : latestRunDir();

  let from = args.from;
  let to = args.to;
  if (args.range) ({ from, to } = parseRangeJson(args.range));

  if (!from || !to) {
    if (!runDir) {
      console.error(
        "[spike:graphs] Kein Zeitraum angegeben und kein Run gefunden. Nutze --from/--to oder --range.",
      );
      process.exit(1);
    }
    const derived = windowFromManifest(
      runDir,
      Number(args["pad-before"] ?? 60),
      Number(args["pad-after"] ?? 30),
    );
    if (!derived) {
      console.error(
        `[spike:graphs] ${runDir} hat kein auswertbares manifest.json — Zeitraum bitte per --from/--to angeben.`,
      );
      process.exit(1);
    }
    ({ from, to } = derived);
    console.log(`[spike:graphs] Zeitraum aus ${runDir}/manifest.json`);
  }

  const outDir =
    args.out ?? (runDir ? join(runDir, "grafana") : join(process.cwd(), "grafana-export"));

  const result = await exportDashboards({
    outDir,
    from,
    to,
    baseUrl: args.url,
    width: args.width ? Number(args.width) : undefined,
    height: args.height ? Number(args.height) : undefined,
    scale: args.scale ? Number(args.scale) : undefined,
    timeZone: args.tz,
    theme: args.theme,
    concurrency: args.concurrency ? Number(args.concurrency) : undefined,
    log: (message) => console.log(message),
  });

  console.log(
    `[spike:graphs] ${result.written}/${result.total} Panels → ${result.outDir} (Übersicht: ${join(result.outDir, "index.md")})`,
  );
  if (result.failed.length > 0) {
    console.warn(`[spike:graphs] ${result.failed.length} Panels fehlgeschlagen:`);
    for (const f of result.failed) {
      console.warn(`  - ${f.dashboard} / ${f.panel}: ${f.error}`);
    }
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("[spike:graphs] Fehlgeschlagen.");
  console.error(error instanceof Error ? error.message : error);
  console.error(
    "Häufigste Ursache: der Renderer läuft nicht — `docker compose up -d renderer` (Container hts-grafana-renderer).",
  );
  process.exit(1);
});
