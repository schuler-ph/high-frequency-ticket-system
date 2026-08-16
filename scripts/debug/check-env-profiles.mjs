#!/usr/bin/env node
/**
 * Prueft, dass jedes Env-Profil vollstaendig ist.
 *
 * Der Anlass ist ein echter Fund: `WORKER_INVENTORY_CYCLE_INTERVAL_SECONDS`
 * fehlte in der frueheren `.env.test` und lebte still vom Zod-Default. Solange
 * es Defaults gibt, faellt so etwas nicht auf — genau deshalb muss die Pruefung
 * maschinell laufen und nicht erst beim Start eines Profils.
 *
 * Zwei Regeln:
 *   1. Jede Variable des Zod-Schemas steht in JEDEM Profil.
 *   2. Jede Lasttest-Variable steht in JEDEM Lasttest-Profil.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PROFILE_DIR = join(REPO_ROOT, "config/env");
const SCHEMA_FILE = join(REPO_ROOT, "packages/env/src/index.ts");

/** Alle Variablen aus dem Zod-Schema — die Liste hat genau eine Quelle. */
const schemaVariables = () => {
  const source = readFileSync(SCHEMA_FILE, "utf8");
  const server = source.slice(
    source.indexOf("server: {"),
    source.indexOf("clientPrefix"),
  );
  return [...server.matchAll(/^\s{4}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
};

/** Variablen, die nur der Lastgenerator und der Seed-Pfad brauchen. */
const LOADTEST_VARIABLES = [
  "LOAD_PROFILE",
  "BASE_URL",
  "EVENT_ID",
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
];

const LOADTEST_PROFILES = new Set([
  "capacity",
  "realism",
  "checkout",
  "funnel",
]);

const keysOf = (file) =>
  new Set(
    readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.slice(0, line.indexOf("="))),
  );

const problems = [];
const required = schemaVariables();

if (required.length === 0) {
  problems.push(
    `Keine Variablen im Schema gefunden (${SCHEMA_FILE}) — Parser passt nicht mehr zur Datei.`,
  );
}

const profiles = readdirSync(PROFILE_DIR)
  .filter((entry) => entry.endsWith(".env"))
  .sort();

if (profiles.length === 0) {
  problems.push(`Keine Profil-Dateien in ${PROFILE_DIR}.`);
}

for (const entry of profiles) {
  const name = entry.slice(0, -".env".length);
  const keys = keysOf(join(PROFILE_DIR, entry));

  for (const variable of required) {
    if (!keys.has(variable)) {
      problems.push(`config/env/${entry}: ${variable} fehlt (Schema-Variable).`);
    }
  }

  if (LOADTEST_PROFILES.has(name)) {
    for (const variable of LOADTEST_VARIABLES) {
      if (!keys.has(variable)) {
        problems.push(
          `config/env/${entry}: ${variable} fehlt (Lasttest-Variable).`,
        );
      }
    }
  }
}

for (const problem of problems) {
  console.error(`[debug:env] ${problem}`);
}

if (problems.length > 0) {
  console.error(`[debug:env] ${problems.length} Problem(e) gefunden.`);
  process.exit(1);
}

console.log(
  `[debug:env] ${profiles.length} Profile, ${required.length} Schema-Variablen — alle vollstaendig.`,
);
