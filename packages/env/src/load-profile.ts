import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

/**
 * Laedt genau eine Profil-Datei aus `config/env/`.
 *
 * Das Profil kommt aus `HTS_ENV_PROFILE` und hat bewusst keinen Default: ein
 * stillschweigend gewaehltes Profil ist genau die Klasse von Fehler, die dieser
 * Umbau beseitigt — ein Lasttest, der versehentlich mit Dev-Werten laeuft, ist
 * schlimmer als einer, der gar nicht startet.
 *
 * Der Pfad wird modul-relativ aufgeloest, nicht ueber `process.cwd()`. Der
 * fruehere Aufruf `config({ path: ["../../.env"] })` funktionierte nur, wenn der
 * Prozess aus `apps/*` oder `packages/*` gestartet wurde; aus dem Repo-Root
 * zeigte er aus dem Repository heraus. `../../../` gilt sowohl fuer `src/` als
 * auch fuer das gebaute `dist/`, weil beide dieselbe Tiefe haben.
 *
 * `override: false` erhaelt die bisherige Rangfolge: was schon im Prozess-Env
 * steht (Shell-inline, CI-Job, VS-Code-Task), schlaegt die Datei.
 */
const PROFILE_DIR = fileURLToPath(
  new URL("../../../config/env/", import.meta.url),
);

const availableProfiles = (): string[] => {
  try {
    return readdirSync(PROFILE_DIR)
      .filter((entry) => entry.endsWith(".env"))
      .map((entry) => entry.slice(0, -".env".length))
      .sort();
  } catch {
    return [];
  }
};

export const loadEnvProfile = (): string => {
  const profile = process.env.HTS_ENV_PROFILE;

  if (profile === undefined || profile.trim() === "") {
    throw new Error(
      `HTS_ENV_PROFILE ist nicht gesetzt. Verfuegbare Profile: ${
        availableProfiles().join(", ") || "(keine gefunden)"
      }. Beispiel: HTS_ENV_PROFILE=dev pnpm dev`,
    );
  }

  const file = `${PROFILE_DIR}${profile}.env`;
  if (!existsSync(file)) {
    throw new Error(
      `Env-Profil "${profile}" existiert nicht (erwartet: ${file}). Verfuegbare Profile: ${
        availableProfiles().join(", ") || "(keine gefunden)"
      }`,
    );
  }

  config({ path: [file], override: false });
  return profile;
};
