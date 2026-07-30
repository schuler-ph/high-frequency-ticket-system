# ADR-008: Zod für Schema Validation & DTOs

- **Datum:** 2026-02-24
- **Kontext:** Request-Validation muss typsicher sein und darf keine doppelten Typ-Deklarationen erzeugen. Fastify nutzt JSON Schema für Serialisierung.
- **Entscheidung:** Zod-Schemas als Single Source of Truth für Request/Response-Typen. TypeScript-Typen werden via `z.infer<>` abgeleitet.
- **Begründung:** Zod ist der De-facto-Standard für Runtime-Validation in TypeScript. Integration mit Fastify via `zod-to-json-schema`. Keine manuellen Typ-Duplikate.
- **Alternativen:** Ajv + manuelle Typen (fehleranfällig), TypeBox (weniger verbreitet).

### Update 2026-03-13: DTO-Vertrag auch für Tests und Worker-Handler

- **Kontext:** Es traten wiederholt schwer auffindbare Testfehler auf, weil Payload-Typen lokal in Tests oder Handler-Dependencies nachgebaut wurden und vom zentralen DTO abwichen (Type Drift).
- **Entscheidung:** Auch in Tests/Mocks/Handler-Deps sind lokale DTO-Duplikate verboten. Payloads werden ausschließlich aus `packages/types` bezogen (Typ-Export oder Zod-Schema-Inferenz).
- **Begründung:** Type Drift verursacht häufig spät sichtbare Fehler in `check-types`/`test` und verlängert die Fix-Zeit unnötig.
- **Umsetzung:**
  - `apps/worker/src/routes/pubsub-listener.ts`
  - `apps/worker/test/routes/pubsub-listener.test.ts`

### Update 2026-03-15: EventId als fixer URL-Parameter in der API

- **Kontext:** `eventId` war inkonsistent verteilt (teils Request-Body, teils Querystring), was API-Clients und Doku unnoetig verkompliziert.
- **Entscheidung:** Ticket-Endpunkte verwenden einheitlich einen festen URL-Parameter `:eventId` (`/api/tickets/:eventId/buy`, `/api/tickets/:eventId/availability`, `/api/tickets/:eventId/reset`).
- **Begruendung:** Einheitlicher API-Contract, klare Ressourcenadressierung und bessere Lesbarkeit der Endpunkte.
- **Umsetzung:** API-Routen in `apps/api/src/routes/api/tickets/*` auf `params`-Schema mit `ticketEventIdSchema` umgestellt.
