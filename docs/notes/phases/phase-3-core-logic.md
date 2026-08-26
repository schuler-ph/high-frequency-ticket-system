# Phase 3: Core Logic (Backend)

Abgeschlossene Detailnotiz zu API-Gateway und Worker aus Phase 3. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

### API Gateway (`apps/api`)

- [x] Setup Fastify Server Instanz (CORS, sensible defaults, Error Handler).
- [x] Integriere `fastify-type-provider-zod` für Request/Response Validierung.
- [x] Implementiere Healthcheck-Route (`GET /health`).
- [x] Setup Redis-Client Plugin für die Verbindung zum lokalen Redis.
- [x] Implementiere `GET /api/tickets/:eventId/availability` Route (liest `tickets:event:{eventId}:available` aus Redis, liefert Sub-Millisekunden Response).
- [x] Setup Google Cloud Pub/Sub Client Plugin für Publish.
- [x] Implementiere `POST /api/tickets/:eventId/buy` Route inkl. Zod Validierung (`BuyTicketRequest`).
- [x] Logik für Kauf: Prüfe Redis `tickets:available` > 0. Wenn ok: Publish an Pub/Sub & HTTP 202. Wenn nicht: HTTP 409.

### Worker Service (`apps/worker`)

- [x] Setup Fastify Server Instanz für den Worker (Healthcheck, Logging).
- [x] Setup Google Cloud Pub/Sub Client Plugin für Subscribe.
- [x] Implementiere Pull-Subscription Listener in Pub/Sub für `BuyTicketEvent` Topic.
- [x] Konsumiere Nachrichten: Simuliere Payment-Provider Latenz (z.B. 1s Sleep).
- [x] Implementiere SQL-Function im Worker: `buy_ticket(...)` fuer `INSERT INTO tickets` + `UPDATE events.sold_count`.
- [x] Bestätige (ACK) erfolgreiche Messages, NACK bei Fehlern im Worker.
