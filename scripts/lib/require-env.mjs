/**
 * Env-Zugriff ohne Fallback (ADR-034).
 *
 * Die Skripte hier lesen `process.env` direkt und nicht ueber `@repo/env` — sie
 * sind Werkzeuge, keine Services, und sollen ohne Build laufen. Damit fehlt
 * ihnen die Zod-Validierung, weshalb sie frueher jeweils eigene Literal-Defaults
 * trugen: `DATABASE_URL` gleich dreifach, und `SALE_OPENS_IN_SECONDS` mit zwei
 * verschiedenen Werten in zwei Dateien. Diese Helfer ersetzen sie durch einen
 * harten Abbruch mit Namensnennung.
 */

const fail = (name, hint) => {
  throw new Error(
    `${name} ist nicht gesetzt. Erwartet aus dem Env-Profil (config/env/<profil>.env, ADR-034)` +
      (hint ? ` — ${hint}` : "") +
      `. Aktuelles Profil: ${process.env.HTS_ENV_PROFILE ?? "(keins)"}`,
  );
};

/** Pflicht-String. */
export const requireEnv = (name, hint) => {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") fail(name, hint);
  return value;
};

/** Pflicht-Zahl, endlich. */
export const requireEnvNumber = (name, hint) => {
  const value = Number(requireEnv(name, hint));
  if (!Number.isFinite(value)) {
    throw new Error(
      `${name} ist keine Zahl: "${process.env[name]}" (Profil: ${
        process.env.HTS_ENV_PROFILE ?? "(keins)"
      })`,
    );
  }
  return value;
};

/**
 * Pflicht-Boolean aus genau `"true"`/`"false"`. Bewusst kein `Boolean(value)`:
 * das macht auch `"false"` zu `true`.
 */
export const requireEnvBoolean = (name, hint) => {
  const value = requireEnv(name, hint);
  if (value !== "true" && value !== "false") {
    throw new Error(
      `${name} muss "true" oder "false" sein, ist aber "${value}" (Profil: ${
        process.env.HTS_ENV_PROFILE ?? "(keins)"
      })`,
    );
  }
  return value === "true";
};
