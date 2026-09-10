import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config, parse } from "dotenv";

/**
 * Laedt genau eine Profil-Datei aus `packages/env/profiles/`.
 *
 * Das Profil kommt aus `HFTS_ENV` und hat bewusst keinen Default: ein
 * stillschweigend gewaehltes Profil ist genau die Klasse von Fehler, die dieser
 * Umbau beseitigt — ein Lasttest, der versehentlich mit Dev-Werten laeuft, ist
 * schlimmer als einer, der gar nicht startet.
 *
 * Der Pfad wird modul-relativ aufgeloest, nicht ueber `process.cwd()`. Der
 * fruehere Aufruf `config({ path: ["../../.env"] })` funktionierte nur, wenn der
 * Prozess aus `apps/*` oder `packages/*` gestartet wurde; aus dem Repo-Root
 * zeigte er aus dem Repository heraus. `../profiles/` gilt sowohl fuer `src/`
 * als auch fuer das gebaute `dist/`, weil beide dieselbe Tiefe haben.
 *
 * Die Profile liegen in diesem Paket und nicht in einem Repo-Ordner, damit sie
 * ueberall mitreisen, wo `@repo/env` mitreist — insbesondere in
 * `pnpm deploy`-Images (ADR-041).
 *
 * `override: false` erhaelt die bisherige Rangfolge: was schon im Prozess-Env
 * steht (Shell-inline, CI-Job, VS-Code-Task), schlaegt die Datei.
 */
const PROFILE_DIR = fileURLToPath(new URL("../profiles/", import.meta.url));

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

/** Profil aus `HFTS_ENV` aufloesen und die Datei pruefen. */
const resolveProfileFile = (): { profile: string; file: string } => {
  const profile = process.env.HFTS_ENV;

  if (profile === undefined || profile.trim() === "") {
    throw new Error(
      `HFTS_ENV ist nicht gesetzt. Verfuegbare Profile: ${
        availableProfiles().join(", ") || "(keine gefunden)"
      }. Beispiel: HFTS_ENV=dev pnpm dev`,
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

  return { profile, file };
};

export const loadEnvProfile = (): string => {
  const { profile, file } = resolveProfileFile();

  config({ path: [file], override: false, quiet: true });
  return profile;
};

/**
 * Liest die Profil-Datei und gibt nur die Variablen mit `prefix` zurueck, ohne
 * `process.env` anzufassen.
 *
 * Fuer Prozesse, die das ganze Profil nicht vertragen: das Vite-Frontend
 * braucht genau die `VITE_*`-Werte, und ein `NODE_ENV` aus dem Profil wuerde
 * Vites Modus-Erkennung (`development`/`production`) ueberschreiben. Der
 * Aufrufer entscheidet, was er ins Prozess-Env uebernimmt; die Rangfolge aus
 * ADR-034 (Prozess-Env schlaegt Datei) bleibt damit seine Sache.
 */
export const profileVarsWithPrefix = (
  prefix: string,
): Record<string, string> => {
  const { file } = resolveProfileFile();

  return Object.fromEntries(
    Object.entries(parse(readFileSync(file, "utf8"))).filter(([key]) =>
      key.startsWith(prefix),
    ),
  );
};
