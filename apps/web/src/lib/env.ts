import { z } from "zod";

const schema = z.object({
  // Leerer String heisst "same origin": `api.ts` setzt jeden Call als
  // `${apiUrl}/api/...` zusammen, aus `""` werden also die relativen Pfade
  // `/api/...`. Damit braucht das Frontend die API-Adresse nicht zu kennen —
  // ein Reverse Proxy vor beiden (nginx im Container, Ingress in GKE) leitet
  // `/api/` an die API weiter. Eine absolute URL bleibt fuer den lokalen
  // Dev-Server erlaubt, wo Web (:10001) und API (:10002) getrennte Origins
  // sind.
  apiUrl: z.union([z.url(), z.literal("")]),
  eventId: z.uuid(),
});

/**
 * Oeffentliche Frontend-Konfiguration. Vite ersetzt `import.meta.env.VITE_*`
 * beim Build durch die Werte aus dem Prozess-Env — die Web-Skripte laden sie
 * aus dem Profil `packages/env/profiles/<profil>.env` (ADR-034). Fehlt ein Wert, bricht
 * die App beim Laden sichtbar ab statt spaeter im Kauf-Handler.
 */
export const env = schema.parse({
  apiUrl: import.meta.env.VITE_API_URL,
  eventId: import.meta.env.VITE_EVENT_ID,
});
