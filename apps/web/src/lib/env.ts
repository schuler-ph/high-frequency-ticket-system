import { z } from "zod";

const schema = z.object({
  apiUrl: z.url(),
  eventId: z.uuid(),
});

/**
 * Oeffentliche Frontend-Konfiguration. Vite ersetzt `import.meta.env.VITE_*`
 * beim Build durch die Werte aus dem Prozess-Env — die Web-Skripte laden sie
 * aus dem Profil `config/env/<profil>.env` (ADR-034). Fehlt ein Wert, bricht
 * die App beim Laden sichtbar ab statt spaeter im Kauf-Handler.
 */
export const env = schema.parse({
  apiUrl: import.meta.env.VITE_API_URL,
  eventId: import.meta.env.VITE_EVENT_ID,
});
