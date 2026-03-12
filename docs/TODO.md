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

## Phase 2: Data Layer & Infrastructure (Local)

- [x] Erstelle `docker-compose.yml` für lokale PostgreSQL, Redis (kläre Redis Url für MCP) und Pub/Sub Emulator.
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
- [x] Implementiere `GET /api/tickets/availability` Route (liest `tickets:available` aus Redis, liefert Sub-Millisekunden Response).
- [x] Setup Google Cloud Pub/Sub Client Plugin für Publish.
- [x] Implementiere `POST /api/tickets/buy` Route inkl. Zod Validierung (`BuyTicketRequest`).
- [x] Logik für Kauf: Prüfe Redis `tickets:available` > 0. Wenn ok: Publish an Pub/Sub & HTTP 202. Wenn nicht: HTTP 409.

### Worker Service (`apps/worker`)

- [x] Setup Fastify Server Instanz für den Worker (Healthcheck, Logging).
- [x] Setup Google Cloud Pub/Sub Client Plugin für Subscribe.
- [x] Implementiere Pull-Subscription Listener in Pub/Sub für `BuyTicketEvent` Topic.
- [x] Konsumiere Nachrichten: Simuliere Payment-Provider Latenz (z.B. 1s Sleep).
- [ ] Implementiere Drizzle-Transaktion im Worker: pro erfolgreichem Kauf `INSERT INTO tickets` (eine Zeile pro Ticket) und `UPDATE events SET sold_count_...`.
- [ ] Bestätige (ACK) erfolgreiche Messages, NACK bei Fehlern im Worker.

## Phase 4: Interface & Testing

### Frontend (`apps/web`)

- [ ] Erstelle Grund-Layout der Next.js Landingpage (Frequency Festival Theme, Hero-Section).
- [ ] Implementiere Komponente für dynamische Ticket-Verfügbarkeitsanzeige (Polling `GET /api/tickets/availability`).
- [ ] Implementiere Kaufen-Button mit Loading State und Error-Handling.
- [ ] Verbinde den Kaufen-Button via Fetch mit `POST /api/tickets/buy`.
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
- [ ] Erstelle Grafana-Dashboard: Redis Performance (Hit/Miss Ratio).
- [ ] Erstelle Grafana-Dashboard: Pub/Sub Queue Depth & Worker Processing Rate.
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
