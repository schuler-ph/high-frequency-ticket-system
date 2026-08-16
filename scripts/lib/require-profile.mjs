#!/usr/bin/env node
/**
 * Vorschaltguard fuer die Root-Skripte (`seed`, `spike`, `spike:report`, ...).
 *
 * Diese Skripte laden ihr Profil ueber `node --env-file=config/env/$X.env` und
 * nicht ueber `@repo/env` — sie sollen ohne Build laufen. Ohne diesen Guard
 * meldet Node bei fehlendem `HTS_ENV_PROFILE` nur `config/env/.env: not found`,
 * was die Ursache verschweigt. Hier steht stattdessen, was fehlt und was es
 * gibt (ADR-034).
 */
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const PROFILE_DIR = fileURLToPath(new URL("../../config/env/", import.meta.url));

const available = () => {
  try {
    return readdirSync(PROFILE_DIR)
      .filter((entry) => entry.endsWith(".env"))
      .map((entry) => entry.slice(0, -".env".length))
      .sort()
      .join(", ");
  } catch {
    return "(keine gefunden)";
  }
};

const profile = process.env.HTS_ENV_PROFILE;

if (profile === undefined || profile.trim() === "") {
  console.error(
    `[env] HTS_ENV_PROFILE ist nicht gesetzt. Verfuegbare Profile: ${available()}.\n` +
      `[env] Beispiel: HTS_ENV_PROFILE=capacity pnpm spike:report`,
  );
  process.exit(1);
}

if (!existsSync(join(PROFILE_DIR, `${profile}.env`))) {
  console.error(
    `[env] Env-Profil "${profile}" existiert nicht. Verfuegbare Profile: ${available()}.`,
  );
  process.exit(1);
}
