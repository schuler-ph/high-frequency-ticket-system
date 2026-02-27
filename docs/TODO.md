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
- [ ] Bereinige generierte Apps zu: `apps/web`, `apps/api`, `apps/worker`.
- [ ] Bereinige generierte Packages zu: `packages/db`, `packages/types`, `packages/config`.
- [ ] Erstelle `apps/api` als leeres Fastify-Projekt mit TypeScript.
- [ ] Erstelle `apps/worker` als leeres Fastify-Projekt mit TypeScript.
- [ ] Installiere und konfiguriere Tailwind CSS in `apps/web`.
- [ ] Erstelle `.github/workflows/ci.yml` für GitHub Actions (lint, typecheck, build).

## Phase 2: Data Layer & Infrastructure (Local)

- [ ] Erstelle `docker-compose.yml` für lokale PostgreSQL, Redis (kläre Redis Url für MCP) und Pub/Sub Emulator.
- [ ] Setze Drizzle ORM in `packages/db` auf.
- [ ] Definiere Schema für `tickets` und `orders` in Drizzle.
- [ ] Definiere Zod DTOs für `BuyTicketRequest` in `packages/types`.
- [ ] Erstelle erste Datenbank-Migration und führe sie lokal aus.

## Phase 3: Core Logic (Backend)

- [ ] Implementiere Fastify Server in `apps/api`.
- [ ] Verbinde `apps/api` mit lokalem Redis für Lese-Zugriffe (Verfügbarkeits-Check).
- [ ] Implementiere Pub/Sub Publisher in `apps/api` für Kauf-Events.
- [ ] Implementiere Fastify Worker in `apps/worker`.
- [ ] Lasse `apps/worker` Nachrichten aus lokalem Pub/Sub Emulator konsumieren.
- [ ] Implementiere sichere Drizzle-Inserts im Worker.

## Phase 4: Interface & Testing

- [ ] Baue Next.js Landingpage in `apps/web` (Frequency Festival Theme, Tailwind).
- [ ] Verbinde Frontend "Kaufen"-Button mit lokaler API.
- [ ] Schreibe k6 Lasttest-Skript in `load-tests/spike.js` (Ramp: 1k→10k→50k RPS, Sell-Out, Cool-Down).
- [ ] Führe lokalen Lasttest gegen Docker-Setup aus und dokumentiere Bottlenecks.

## Phase 4.5: Monitoring & Observability

- [ ] Füge Prometheus-Metriken zu `apps/api` hinzu (`prom-client`).
- [ ] Füge Grafana + Prometheus zu `docker-compose.yml` hinzu.
- [ ] Erstelle Grafana-Dashboard: API Latenz, RPS, Error-Rate.
- [ ] Erstelle Grafana-Dashboard: Redis Hit/Miss Ratio.
- [ ] Erstelle Grafana-Dashboard: Pub/Sub Queue Depth & Worker Processing Rate.
- [ ] Verbinde k6 Output mit Grafana für Live-Lasttest-Visualisierung.
- [ ] Erstelle README-Screenshots der Grafana-Dashboards unter Last.

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
