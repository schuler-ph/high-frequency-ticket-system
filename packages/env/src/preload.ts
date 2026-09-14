import { loadEnvProfile } from "./load-profile.ts";

/**
 * Laedt das Env-Profil, bevor sonst irgendetwas laeuft — gedacht fuer
 * `node --import @repo/env/preload …`.
 *
 * Der Anlass ist fastify-cli: es liest seine Optionen (Praefix `FASTIFY_`)
 * aus dem Prozess-Env, und zwar beim Parsen der Kommandozeile — also bevor es
 * `dist/app.js` und damit `@repo/env` ueberhaupt laedt. Ein Wert wie
 * `FASTIFY_CLOSE_GRACE_DELAY` aus der Profil-Datei kaeme ohne diesen Vorlauf
 * zu spaet und faellt still auf den CLI-Default zurueck (ADR-045).
 *
 * Ein zweiter Aufruf aus `@repo/env` heraus ist folgenlos: `override: false`
 * laesst bereits gesetzte Werte stehen.
 */
loadEnvProfile();
