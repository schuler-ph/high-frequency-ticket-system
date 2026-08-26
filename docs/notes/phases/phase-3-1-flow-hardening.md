# Phase 3.1: Flow Hardening (Korrektheit + Performance)

Abgeschlossene Detailnotiz zur Haertung des Kauf-Flows aus Phase 3.1. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

### Redis Keying & Datenmodell

- [x] Ersetze globale Redis-Keys durch event-spezifische Keys (`tickets:event:{eventId}:total`, `tickets:event:{eventId}:available`).
- [x] Definiere ein zentrales Naming-Utility für Redis-Keys in API und Worker, um Tippfehler/Drift zu vermeiden.
- [x] Erweitere Availability-Route auf event-spezifische Abfrage (`GET /api/tickets/:eventId/availability`).
- [x] Normalisiere die Availability-Response auf numerische Werte statt Redis-Strings, damit API-Contract und Architektur konsistent bleiben.

### Reservation-Flow in der API

- [x] Implementiere atomare Reservierung in Redis (decrement nur wenn `available > 0`).
- [x] Erweitere das zentrale Redis-Key-Naming um Reservation-Keys pro `eventId` + `orderId`.
- [x] Speichere pro Kauf eine Reservation (`orderId`) mit TTL in Redis.
- [x] Rolle Reservation sauber zurück, wenn Pub/Sub Publish fehlschlägt.

### Worker Finalisierung & Kompensation

- [x] Validiere und dokumentiere ACK/NACK-Regeln (transienter Fehler = NACK, permanenter Business-Fehler = ACK).
- [x] Füge Kompensation hinzu: bei terminalem Fehler Reservation freigeben (Redis `INCR`).
- [x] Mache Worker-Processing idempotent über `orderId` (keine doppelte DB-Verarbeitung bei Redelivery).

### Orders ↔ Tickets Verknüpfung

- [x] Definiere persistentes `orders` Datenmodell (Status: `pending|completed|failed`, Bezug zu `eventId`, Zeitstempel).
- [x] Speichere `orderId` aus der API dauerhaft in der Datenbank (nicht nur in Pub/Sub Payload).
- [x] Verknüpfe jedes erzeugte Ticket mit der zugehörigen Order (`tickets.order_id` oder Join-Tabelle), inkl. Foreign Key.
- [x] Aktualisiere Worker-Flow: bei erfolgreichem `buy_ticket(...)` Order auf `completed` setzen und Ticket-Referenz speichern.
- [x] Ergänze Failure-Path: Order auf `failed` setzen (inkl. Fehlergrund) bei terminalen Business-Fehlern.
- [x] Mache `pending` Orders direkt nach `POST /api/tickets/:eventId/buy` beobachtbar, damit `GET /api/orders/:orderId` unmittelbar nach `202 Accepted` einen konsistenten Status liefern kann.
- [x] Materialisiere den finalen Order-Status inkl. Ticket-Referenz durch den Worker in Redis, damit die API `GET /api/orders/:orderId` ohne PostgreSQL bedienen kann.
- [x] Implementiere `GET /api/orders/:orderId` inkl. Zod-Request/Response-Schemas und Redis-Read fuer Order-Status plus Ticket-Referenz.
- [x] Schreibe gezielte API-Route-Tests fuer `GET /api/orders/:orderId` (`completed`, `pending`, `failed`).
- [x] Schreibe den fokussierten Flow-Test: `POST /buy` liefert `orderId`, Worker verarbeitet, `GET /api/orders/:orderId` liest den finalen Zustand inkl. Ticket-Referenz aus Redis.

### Sync-Strategie Redis ↔ DB

- [x] Implementiere den Reconcile-Kern im Worker, der pro Event `available = total_capacity - sold_count - active_reservations` berechnet und die Redis-Counter korrigiert.
- [x] Verdrahte den Reconcile-Kern beim Worker-Start, sodass der Worker beim Boot einmalig alle Event-Counter gegen PostgreSQL und aktive Redis-Reservationen abgleicht.
- [x] Definiere Betriebsmodi und Intervalle in `@repo/env`: `WORKER_RECONCILE_MODE` (`peak`|`normal`, Default: `normal`), `WORKER_RECONCILE_INTERVAL_PEAK_SECONDS` (Default: 10), `WORKER_RECONCILE_INTERVAL_NORMAL_SECONDS` (Default: 60).
- [x] Starte Reconcile zyklisch nach dem Startup-Reconcile (self-scheduling `setTimeout`, kein `setInterval`; sauber in Fastify `onClose` stoppbar; siehe ADR-022).

### Tests & Observability für den Flow

- [x] Schreibe Integrationstests für Reserve/Publish-Rollback/Compensation (Happy + Failure Paths).
- [x] Ergänze Metriken für den Order-Lifecycle: `accepted`, `completed`, `failed` (Counter; `pending` ist via PromQL berechenbar).
- [x] Ergänze Metriken für Reservationen und Fehlerpfade: Reservierungen erstellt, Publish-Rollbacks, Worker-Kompensationen.
- [x] Ergänze Metriken für Worker-Robustheit: Redeliveries, Idempotenz-Kurzschlüsse, Processing-Lock-Konflikte.
- [x] Messe End-to-End-Latenz von `POST /buy` bis `order completed|failed`.
- [x] Ergänze Metriken für Redis-DB-Drift (`available` vs. `capacity - sold_count - active_reservations`).
- [x] Dokumentiere den finalen End-to-End-Flow in `ARCHITECTURE.md` und ADR in `DECISIONS.md`.
- [x] Ergaenze CI-Guardrails fuer Migrations-Journal und `buy_ticket`-Vertrag vor Lint/Typecheck/Build.
