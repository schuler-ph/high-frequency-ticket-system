#!/usr/bin/env node
/**
 * Startet ein Kommando mit dem Env-Profil aus `config/env/$HTS_ENV_PROFILE.env`
 * im Prozess-Env — fuer Programme, die `node --env-file` nicht vertragen.
 *
 * Anlass war Next.js, das `--env-file` in seine Worker-Threads weiterreichte
 * und daran scheiterte (`ERR_WORKER_INVALID_EXEC_ARGV`); heute nutzt das
 * Vite-Frontend das Skript, weil Vite `.env`-Dateien nur aus dem eigenen
 * Verzeichnis liest und das Profil in `config/env/` liegt. Das Skript liest die
 * Profil-Datei selbst (`util.parseEnv`, Node >= 20.12) und startet das
 * Kommando als Kindprozess mit zusammengefuehrtem Env. Rangfolge wie bei
 * `--env-file` und `@repo/env`: was schon im Prozess-Env steht (Shell-inline,
 * CI, VS-Code-Task), schlaegt die Datei (ADR-034).
 *
 * Aufruf: node scripts/lib/run-with-profile.mjs [--prefix=X_] <kommando> [args...]
 * Das Kommando wird ueber PATH aufgeloest — `pnpm run` legt `node_modules/.bin`
 * dorthin, `vite` funktioniert also unveraendert. Mit `--prefix=` gelangen nur
 * Variablen mit diesem Praefix aus dem Profil in den Kindprozess.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Derselbe Guard wie fuer die Root-Skripte: benennt fehlendes oder unbekanntes
// Profil und beendet den Prozess mit Exit 1.
await import("./require-profile.mjs");

const PROFILE_DIR = fileURLToPath(
  new URL("../../config/env/", import.meta.url),
);
const profilePath = join(PROFILE_DIR, `${process.env.HTS_ENV_PROFILE}.env`);

if (!existsSync(profilePath)) {
  console.error(`[env] Profil-Datei fehlt: ${profilePath}`);
  process.exit(1);
}

// `--prefix=VITE_` reicht nur Variablen mit diesem Praefix durch. Das Frontend
// braucht genau die; alles andere (NODE_ENV=development aus `dev`,
// NODE_ENV=production aus den Lasttest-Profilen, DATABASE_URL, ...) hat in
// einem Vite-Prozess nichts verloren — ein fremdes NODE_ENV wuerde Vites
// Modus-Erkennung (`development`/`production`) ueberschreiben.
const argv = process.argv.slice(2);
let prefix = null;
while (argv[0]?.startsWith("--prefix=")) {
  prefix = argv.shift().slice("--prefix=".length);
}
const [command, ...args] = argv;
if (!command) {
  console.error(
    "[env] Kein Kommando angegeben. Aufruf: node scripts/lib/run-with-profile.mjs [--prefix=X_] <kommando> [args...]",
  );
  process.exit(2);
}

const fromProfile = Object.fromEntries(
  Object.entries(parseEnv(readFileSync(profilePath, "utf8"))).filter(
    ([key]) => prefix === null || key.startsWith(prefix),
  ),
);
const env = { ...fromProfile, ...process.env };

const result = spawnSync(command, args, { stdio: "inherit", env });

if (result.error) {
  console.error(
    `[env] Konnte "${command}" nicht starten: ${result.error.message}`,
  );
  process.exit(1);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
