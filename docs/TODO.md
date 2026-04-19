# Implementation Roadmap: High-Frequency Ticket System

## Phase 0: Planung & Entscheidungen

- [x] Backend Runtime: Node.js (v20+)
- [x] Backend Framework: Fastify
- [x] ORM: Drizzle ORM (Code-First)
- [x] Datenbank: PostgreSQL (Cloud SQL, Spanner-ready Architektur)
- [x] Frontend: Next.js + Tailwind CSS
- [x] Event-Theme: Frequency Festival 20XX VIP-Pässe (St. Pölten, AT)
- [x] Monitoring: Prometheus + Grafana (lokal via Docker)
- [x] CI/CD Pipeline: GitHub Actions (lint, typecheck, build)
- [x] Erstelle `docs/DECISIONS.md` (ADR-Log) mit allen bisherigen Architekturentscheidungen.
- [x] Erstelle `docs/ARCHITECTURE.md` mit System-Übersicht und Datenfluss-Diagramm.
- [x] Aktualisiere `docs/REQUIREMENTS.md` mit Event-Theme, Monitoring-Stack und CI/CD.

## Phase 1: Foundation & Tooling

- [x] Initialisiere Turborepo (`npx create-turbo@latest`) mit pnpm und Name "high-frequency-ticket-system".
- [x] Füge `.vscode/extensions.json` mit Empfehlungen für Draw.io hinzu.
- [x] Generiere api und worker mit fastify-cli und passe sie auf unser turborepo an.
- [x] Generiere drizzle ORM package
- [x] Installiere und konfiguriere Tailwind CSS in `apps/web`.
- [x] Erstelle `.github/workflows/ci.yml` für GitHub Actions (lint, typecheck, build).
- [x] Caching in GitHub Actions aktivieren
- [x] Erstelle `@repo/env` Paket mit `@t3-oss/env-core` & Zod für strikte Laufzeit-Konfigurationsvalidierung.
- [x] Migriere direkte `tsc`-CLI-Aufrufe in Workspace-Skripten (`build`, `check-types`, Teile von `test`, `watch`) auf `tsgo`.
- [x] Stabilisiere API/Worker-Tests mit deterministischen Test-Entrypoints (`test/run-tests.ts`) statt glob-basierter Discovery.
- [x] Ersetze ad-hoc Debug-Einzeiler durch versionierte Debug-Skripte (`debug:*`) fuer Runtime-, Migrations- und DB-Vertragschecks.
- [x] Ergaenze kurzes Debugging-Runbook (`docs/DEBUGGING.md`) fuer reproduzierbare Diagnoseablaeufe.

## Phase 2: Data Layer & Infrastructure (Local)

- [x] Erstelle `docker-compose.yml` für lokale PostgreSQL, Redis (kläre Redis Url für MCP) und Pub/Sub Emulator.
- [ ] Erstelle ein lokales Reset/Seeding-Skript für PostgreSQL, Redis und Pub/Sub Emulator (inkl. reproducible Testdaten-Setup).
- [x] Definiere PostgreSQL Verbindungs-URL in `.env` (Docker-Compose kompatibel).
- [x] Setze Drizzle ORM in `packages/db` auf.
- [x] Definiere Schema für `tickets` und `orders` in Drizzle.
- [x] Definiere Zod DTOs für `BuyTicketRequest` in `packages/types`.
- [x] Erstelle erste Datenbank-Migration und führe sie lokal aus.

## Phase 3: Core Logic (Backend)

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

## Phase 3.5: Flow Hardening (Korrektheit + Performance)

### Redis Keying & Datenmodell

- [x] Ersetze globale Redis-Keys durch event-spezifische Keys (`tickets:event:{eventId}:total`, `tickets:event:{eventId}:available`).
- [x] Definiere ein zentrales Naming-Utility für Redis-Keys in API und Worker, um Tippfehler/Drift zu vermeiden.
- [x] Erweitere Availability-Route auf event-spezifische Abfrage (`GET /api/tickets/:eventId/availability`).

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
- [ ] Aktualisiere Worker-Flow: bei erfolgreichem `buy_ticket(...)` Order auf `completed` setzen und Ticket-Referenz speichern.
- [ ] Ergänze Failure-Path: Order auf `failed` setzen (inkl. Fehlergrund) bei terminalen Business-Fehlern.
- [ ] Baue gezielte Tests: `POST /buy` liefert `orderId`, Worker verarbeitet, `GET /orders/:orderId` zeigt finalen Zustand inkl. Ticket-Referenz.

### Sync-Strategie Redis ↔ DB

- [ ] Implementiere Reconcile-Job (API oder Worker), der `available = total_capacity - sold_count - active_reservations` prüft.
- [ ] Starte Reconcile beim Service-Start und zyklisch im Betrieb.
- [ ] Definiere Intervalle: Peak-Last 5–10s, Normalbetrieb 30–60s.

### Tests & Observability für den Flow

- [ ] Schreibe Integrationstests für Reserve/Publish-Rollback/Compensation (Happy + Failure Paths).
- [ ] Ergänze Metriken für den Order-Lifecycle: `accepted`, `pending`, `completed`, `failed`.
- [ ] Ergänze Metriken für Reservationen und Fehlerpfade: Reservierungen erstellt, Publish-Rollbacks, Worker-Kompensationen.
- [ ] Ergänze Metriken für Worker-Robustheit: Redeliveries, Idempotenz-Kurzschlüsse, Processing-Lock-Konflikte.
- [ ] Messe End-to-End-Latenz von `POST /buy` bis `order completed|failed`.
- [ ] Ergänze Metriken für Redis-DB-Drift (`available` vs. `capacity - sold_count - active_reservations`).
- [ ] Dokumentiere den finalen End-to-End-Flow in `ARCHITECTURE.md` und ADR in `DECISIONS.md`.
- [x] Ergaenze CI-Guardrails fuer Migrations-Journal und `buy_ticket`-Vertrag vor Lint/Typecheck/Build.

## Phase 4: Interface & Testing

### Frontend (`apps/web`)

- [ ] Erstelle Grund-Layout der Next.js Landingpage (Frequency Festival Theme, Hero-Section).
- [ ] Implementiere Komponente für dynamische Ticket-Verfügbarkeitsanzeige (Polling `GET /api/tickets/:eventId/availability`).
- [ ] Implementiere Kaufen-Button mit Loading State und Error-Handling.
- [ ] Verbinde den Kaufen-Button via Fetch mit `POST /api/tickets/:eventId/buy`.
- [ ] Baue UI Feedback ein (Toast/Alert für Erfolg "In Warteschlange" vs. "Ausverkauft").

### Lasttests (`load-tests/`)

- [ ] Initialisiere k6 Lasttest-Skript (`spike.js`) mit Basis-Struktur.
- [ ] Definiere Ramp-Up Szenario im Skript (1k → 10k → 50k RPS, Sustained, Cool-Down).
- [ ] Implementiere HTTP-Requests im k6-Skript (Availability checken, Tickets kaufen).
- [ ] Führe lokalen Lasttest gegen Docker-Setup aus und dokumentiere erste Bottlenecks.

## Phase 4.5: Monitoring & Observability

- [ ] Integriere `prom-client` in `apps/api` und Worker für Fastify-Metriken (RPS, Latenz).
- [ ] Exponiere `/metrics` Endpunkt für Prometheus-Scraping.
- [ ] Füge Grafana + Prometheus Services zur `docker-compose.yml` hinzu.
- [ ] Konfiguriere Prometheus Target Scraping (für API & Worker Container).
- [ ] Erstelle Grafana-Dashboard: API Performance (Latenz, RPS, Error-Rate).
- [ ] Erstelle Grafana-Dashboard: Order Lifecycle (`accepted`, `pending`, `completed`, `failed`, Completion-Rate).
- [ ] Erstelle Grafana-Dashboard: Order Completion Latency (`buy accepted` → `completed|failed`, p50/p95/p99).
- [ ] Erstelle Grafana-Dashboard: Redis Performance (Hit/Miss Ratio).
- [ ] Erstelle Grafana-Dashboard: Pub/Sub Queue Depth & Worker Processing Rate.
- [ ] Erstelle Grafana-Dashboard: Worker Reliability (Redeliveries, Idempotenz-Hits, Processing-Lock-Konflikte, Kompensationen).
- [ ] Erstelle Grafana-Dashboard: Reservation & Consistency (aktive Reservations, Publish-Rollbacks, Redis-DB-Drift).
- [ ] Konfiguriere k6 Output zur Speicherung in Prometheus/Grafana für Live-Views.
- [ ] Erzeuge Screenshots der Dashboards unter extremer Last für die README.

## Phase 5: Cloud Deployment (GCP)

- [ ] Erstelle Terraform-Skripte für VPC, Cloud SQL, Memorystore und GKE.
- [ ] Erstelle Dockerfiles für API, Worker und Web.
- [ ] Schreibe Kubernetes Deployment/Service/Ingress Manifeste.
- [ ] Führe Cloud-Lasttest aus und sammle Metriken für die README.

## Phase 6: Optional & Resilience (Maximum Learning)

- [ ] Implementiere Dead Letter Queue (DLQ) in Pub/Sub und einen Retry/Replay-Mechanismus im Worker.
- [ ] Implementiere Idempotency Keys für die Ticket-Kauf-Route (API & DB) um doppelte Käufe zu verhindern.
- [ ] Füge Rate Limiting in Fastify (via Redis) als Bot-Protection hinzu.
- [ ] Integriere den k6 Lasttest als Quality Gate in GitHub Actions (Fail bei großer Latenz oder hohen Error-Rates).
- [ ] Simuliere Chaos Engineering (z.B. Redis oder Worker Ausfälle während des Lasttests) um zu testen, ob das System graceful degradiert.
- [ ] Definiere Polling-Strategie fuer Order-Status (Backoff + Jitter, optional Long-Polling) zur Load-Reduktion.
- [ ] Konfiguriere `maxDeliveryAttempts` + Dead-Letter Topic pro Subscription, um Retry-Stuerme zu begrenzen.
- [ ] Definiere klare Poison-Message-Policy (ACK+DLQ vs. NACK) fuer invalides JSON, Schema-Fehler und unbekannte Event-Versionen.
- [ ] Implementiere Worker-Graceful-Shutdown mit Drain-Verhalten (in-flight Messages abschliessen, Locks sauber freigeben).
- [ ] Ergänze Reaper-Job fuer stale `pending` Orders und abgelaufene Reservationen inkl. sicherer Kompensation.
- [ ] Erstelle Replay-Tooling fuer DLQ-Nachrichten (selektiver Replay nach Fehlerklasse, Dry-Run-Modus).
- [ ] Definiere SLOs + Alerting fuer Resilience-Signale (NACK-Rate, Redelivery-Rate, DLQ-Groesse, stuck pending orders).
- [ ] Dokumentiere Incident-Runbook fuer Queue-Backlog, Redis-Ausfall und DB-Partial-Outage (Detection, Mitigation, Recovery).
- [ ] Schließe die letzte Ausnahme in `apps/web` (`check-types`) auf `tsgo`, sobald Side-Effect-CSS-Imports (`./globals.css`) im Native-Preview kompatibel sind.
- [ ] Migriere Dev-Watch-Restart-Flow von `tsc-watch` auf einen `tsgo`-basierten Restart-Workflow (API + Worker).
