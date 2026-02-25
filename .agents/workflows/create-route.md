---
description: Wie man eine neue Fastify-Route in diesem Projekt anlegt.
---

# Workflow: Create Fastify Route

1. **Zod Schema definieren**: Erstelle oder erweitere das entsprechende Zod-Schema in `packages/types/src/` (z.B. für Body, Params, Querystring und Response).
2. **Typen exportieren**: Stelle sicher, dass das Schema und der abgeleitete TypeScript-Typ (`z.infer`) in `packages/types/src/index.ts` (oder der jeweiligen Barrel-File) exportiert werden.
3. **Route & Controller definieren**: Erstelle die Routen-Definition in `apps/api/src/routes/[feature]/index.ts` (oder einer spezifischen Datei).
   - Nutze den Fastify Zod Type Provider (`fastify.withTypeProvider<ZodTypeProvider>()`) für Ende-zu-Ende-Typsicherheit.
   - Binde die in Schritt 1 erstellten Schemas in das `schema`-Objekt der Route ein.
4. **Geschäftslogik kapseln**: Lagere komplexe Logik (Redis-Calls, Pub/Sub-Publishing) in Services aus und rufe diese im Controller/Route-Handler auf.
5. **Kein Express.js**: Verwende niemals `res.send()` oder `req.body` ohne vorherige Schema-Validierung. Halte dich an die Fastify-Pluginstruktur und nutze `reply.send()` oder returne direkt das Payload-Objekt.
