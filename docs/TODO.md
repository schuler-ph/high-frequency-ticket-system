# Implementation Roadmap: High-Frequency Ticket System

## Ausführungsreihenfolge (Roadmap)

Die Phasen unten sind historisch gewachsen und **nicht** mehr strikt von oben nach unten abzuarbeiten; diese Roadmap gibt die Reihenfolge nach Abhaengigkeit vor. Leitprinzip: erst Payment-Split (Phase 4.7) fertig, **dann** messen. → [Details](TODO-ARCHIVE.md#roadmap-ausfuehrungsreihenfolge-vorspann)

1. **Stage 1 — Payment-Split (Phase 4.7):** Reserve/Pay/Publish-Split, Worker-Sleep raus, Checkout-Frontend. Aktive Arbeit; aendert das Lastprofil aller nachgelagerten Messungen.
2. **Stage 2 — DB-Hot-Row (Backlog #7):** `sold_count`-Hot-Row-UPDATE entfernen. Nach dem Sleep-Removal der naechste echte Limiter — vor jeder "echten" Baseline.
3. **Stage 3 — Pre-Baseline-Cleanups (Backlog):** #9-Provisioning, Lua-vs-Redis-Test, OpenAPI-Schemas (inkl. `/pay`+`/cancel`), k6-Metriken. Guenstig, gebuendelt vor dem Kapazitaetslauf.
4. **Stage 4 — Echter Kapazitaetsnachweis (Backlog):** Report-Automation-MVP, verteilter Runner, Baseline B, Dashboard-Screenshots. Erst jetzt misst der Lauf echte Infra-Kapazitaet.
5. **Stage 5 — Cloud-Deployment (Phase 5):** Terraform, Dockerfiles, k8s, Sale-Unlock-Zeitquelle, Reconcile-HA.
6. **Stage 6 — Resilience & Optional (Phase 6):** DLQ, Idempotency-Keys, Rate-Limiting, Reaper, Chaos, Runbooks, SLOs.

Die konkreten offenen Tasks fuer Stage 2–4 liegen im **Backlog** direkt nach Phase 4.7 (aus den abgeschlossenen Phasen 4 / 4.5 / 4.6 dorthin verschoben, damit diese Phasen als abgeschlossen lesbar bleiben — siehe append-forward-Regel in CLAUDE.md).

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
- [x] Füge `.vscode/extensions.json` mit Empfehlungen für Mermaid-Diagramme hinzu.
- [x] Generiere api und worker mit fastify-cli und passe sie auf unser turborepo an.
- [x] Generiere drizzle ORM package
- [x] Installiere und konfiguriere Tailwind CSS in `apps/web`.
- [x] Erstelle `.github/workflows/ci.yml` für GitHub Actions (lint, typecheck, build).
- [x] Caching in GitHub Actions aktivieren
- [x] Erstelle `@repo/env` Paket mit `@t3-oss/env-core` & Zod für strikte Laufzeit-Konfigurationsvalidierung.
- [x] Migriere direkte `tsc`-CLI-Aufrufe in Workspace-Skripten weitgehend auf `tsgo` (`build`, `check-types`, Teile von `test`); offene Ausnahmen bleiben `apps/web` `check-types` und der Dev-Restart-Flow via `tsc-watch`.
- [x] Mache `@repo/env` und `@repo/types` zu buildbaren Runtime-Paketen mit `types`/`source`/`default`-Exports und verdrahte direkte `api`/`worker`-Builds auf diese Runtime-Abhaengigkeiten.
- [x] Stabilisiere API/Worker-Tests mit reproduzierbarer Datei-Discovery und klarer Trennung zwischen Service-Unit-Tests und DB-Tests im `@repo/db` Paket.
- [x] Ersetze ad-hoc Debug-Einzeiler durch versionierte Debug-Skripte (`debug:*`) fuer Runtime-, Migrations- und DB-Vertragschecks.
- [x] Ergaenze kurzes Debugging-Runbook (`docs/DEBUGGING.md`) fuer reproduzierbare Diagnoseablaeufe.
- [x] Erweitere CI auf Node-Kompatibilitaetsmatrix (22 + 24) und definiere Node 24 als primaere Test-Runtime.
- [x] Vereinfache den Backend-Testpfad auf direkte paketlokale `node:test`-Aufrufe gegen native `.ts`-Quellen via `--conditions=source` und entferne Shared-Runner-, Vitest- und Loader-Experimentpfade aus dem Test-Hot-Path.
- [x] Trenne lokale Testskripte vom CI-/Coverage-Pfad: `test` bleibt schnell und direkt, `test:coverage`/`test:ci` liefern Coverage (API/Worker via native Node-Coverage, `@repo/db` weiter via `c8`).
- [x] Stabilisiere das Root-Testkommando ueber `turbo run test --ui=stream --concurrency=1` und reduziere verbleibende Flake-Quellen in kleinen Backend-Suites.

## Phase 2: Data Layer & Infrastructure (Local)

- [x] Erstelle `docker-compose.yml` für lokale PostgreSQL, Redis (kläre Redis Url für MCP) und Pub/Sub Emulator.
- [x] Erstelle ein lokales Reset/Seeding-Skript für PostgreSQL, Redis und Pub/Sub Emulator (inkl. reproducible Testdaten-Setup).
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

## Phase 4: Interface & Testing

### Frontend (`apps/web`)

- [x] Erstelle Grund-Layout der Next.js Landingpage (Frequency Festival Theme, Hero-Section).
- [x] Implementiere Komponente für dynamische Ticket-Verfügbarkeitsanzeige (Polling `GET /api/tickets/:eventId/availability`).
- [x] Implementiere Kaufen-Button mit Loading State und Error-Handling.
- [x] Verbinde den Kaufen-Button via Fetch mit `POST /api/tickets/:eventId/buy`.
- [x] Baue UI Feedback ein (Toast/Alert für Erfolg "In Warteschlange" vs. "Ausverkauft").

### Lasttests (`load-tests/`)

- [x] Initialisiere k6 Lasttest-Skript (`spike.js`) mit Basis-Struktur.
- [x] Definiere Ramp-Up Szenario im Skript (1k → 10k → 50k RPS, Sustained, Cool-Down).
- [x] Implementiere HTTP-Requests im k6-Skript (Availability checken, Tickets kaufen).
- [x] Führe lokalen Lasttest gegen Docker-Setup aus und dokumentiere erste Bottlenecks (`docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md`; Baseline A: 11,7k Peak-RPS, 68,24 % dropped iterations, 420.951 accepted = completed nach Drain, ~406 s mittlere E2E-Latenz).
- [x] Erzeuge Screenshots der Dashboards unter extremer Last fuer die README.
- [x] Sale-Unlock-Gate: `tickets:event:{eventId}:opensAt`-Redis-Key im atomaren Reserve-Script, `TooEarlyError` (HTTP 425), `SALE_OPENS_IN_SECONDS` im Seed-Skript (ADR-024) — Reaktion auf Baseline A, in der der Verkauf ab `t=0` offen war statt einen echten Sale-Start abzubilden.
- [x] **Reaktive Sold-Out-Erkennung im Lasttest:** `spike-phase-a/b.js`, orchestriert von `run-spike.mjs` statt fixer Phasen-Timer — Baseline A endete sonst mitten im Peak. → ADR-025, [Details](TODO-ARCHIVE.md#reaktive-sold-out-erkennung-im-lasttest)
- [x] Dokumentiere die automatisierbare Evidence-/Report-Pipeline inkl. verwendeter Prometheus-, PostgreSQL- und Redis-Abfragen, Validitaetsregeln, Artefaktvertrag und schrittweisem Implementierungsplan (`docs/suggested/LOAD-TEST-REPORT-AUTOMATION.md`).

## Phase 4.5: Monitoring & Observability

- [x] Integriere `prom-client` in `apps/api` und Worker für Custom-Metriken (Counter, Histogram).
- [x] Exponiere `/metrics` Endpunkt für Prometheus-Scraping (API & Worker).
- [x] Messe E2E-Latenz von `POST /buy` bis `order completed|failed` als Prometheus-Histogram (`order_e2e_latency_seconds`, Labels: `event_id`, `status`).
- [x] Füge Grafana + Prometheus Services zur `docker-compose.yml` hinzu.
- [x] Konfiguriere Prometheus Target Scraping (für API & Worker Container).
- [x] Erstelle Grafana-Dashboard: API Performance (Latenz, RPS, Error-Rate).
- [x] Erstelle Grafana-Dashboard: Order Lifecycle (`accepted`, `pending`, `completed`, `failed`, Completion-Rate).
- [x] Erstelle Grafana-Dashboard: Order Completion Latency (`buy accepted` → `completed|failed`, p50/p95/p99).
- [x] Erstelle Grafana-Dashboard: Redis Performance (Hit/Miss Ratio) — `redis_exporter` (`hts-redis-exporter`, Host-Port 10009) + Prometheus-Job `redis` ergänzt; Panels sind nicht mehr Placeholder (ADR-026).
- [x] Erstelle Grafana-Dashboard: Pub/Sub Queue Depth & Worker Processing Rate — Worker-Proxy-Panels implementiert; vollständige Queue-Tiefe erfordert Stackdriver-Exporter (GCP) oder pubsub_exporter.
- [x] Erstelle Grafana-Dashboard: Worker Reliability (Redeliveries, Idempotenz-Hits, Processing-Lock-Konflikte, Kompensationen).
- [x] Erstelle Grafana-Dashboard: Reservation & Consistency (aktive Reservations, Publish-Rollbacks, Redis-DB-Drift).
- [x] Konfiguriere k6 Output zur Speicherung in Prometheus/Grafana für Live-Views (`pnpm spike` nutzt `experimental-prometheus-rw`).
- [x] **Dashboard-PromQL gegen fehlende Zero-Serien haerten:** jeder potenziell fehlende Operand mit `or vector(0)` umschlossen, damit gesundes Null nicht als `No data` verschwindet. → [Details](TODO-ARCHIVE.md#dashboard-promql-gegen-fehlende-zero-serien)
- [x] **E2E-Latenz-Buckets erweitern, Throughput-Panel ehrlich benennen:** Buckets bis 600 s (Baseline A klippte bei 30 s), „Completion Rate“ → „Throughput Ratio“, Legenden-`sum` → `last`. → ADR-023-Nachtrag, [Details](TODO-ARCHIVE.md#e2e-latenz-buckets-und-throughput-panel)
- [x] **`redis_exporter` + DB-/Runtime-Bottleneck-Metriken:** Pool-Wait, Query-Latency und Lock-Wait aus dem Worker, sichtbar im Dashboard „DB & Runtime“. → ADR-026, [Details](TODO-ARCHIVE.md#redis_exporter-und-db-runtime-bottleneck-metriken)

## Phase 4.6: Standard-Flow-Optimierung (vgl. `docs/reports/ANALYSIS-STANDARD-FLOW.md`)

Risikoarme Massnahmen (Analyse §9, Nr. 1/2/6/8/10) und der Handler-Block (Nr. 3/4) — umgesetzt:

- [x] #10: Redis-Typ-Schatten/Casts durch zentrales `@repo/types/redis-client` ersetzen; Zod-Parse selbst konstruierter Literale durch `satisfies` (Zod bleibt an allen externen Grenzen).
- [x] #1: Reserve+Reservation+Pending-Order als **ein** atomares Lua-Script via ioredis `defineCommand`/EVALSHA; Publish-Rollback als idempotentes Gegen-Script (3→1 RTT, ADR-005-Update).
- [x] #2: Worker Idempotenz-Check+Lock als ein Script (`beginOrderProcessing`), Finalisierung (Order-Cache + `processed`-Marker + Lock-Release) als ein Script (5→2 RTT pro Message, ACK/NACK-Semantik unveraendert).
- [x] #6: Reconcile korrigiert `available` als Delta (`INCRBY`) statt absolutem `MSET` (schliesst das Lost-Decrement-Fenster); `redis_db_drift_tickets`-Gauge (ADR-023) verdrahtet.
- [x] #8: `PUBSUB_FLOW_CONTROL_MAX_MESSAGES` (Default 500) und `DATABASE_POOL_MAX` (Default 20) als explizite, aufeinander abgestimmte Env-Knobs (siehe ARCHITECTURE.md "Worker-Durchsatz & Backpressure").
- [x] #3: Handler liefert `BuyTicketOutcome`-Wert; ACK/NACK + Metriken als Policy-Tabelle (`buyTicketOutcomePolicy`) im Listener — die Doku-Tabelle ist woertlich Code, ack/nack genau einmal pro Nachricht.
- [x] #4: `processing`-Lock gestrichen — Idempotenz traegt die `buy_ticket`-DB-Transaktion (ON CONFLICT); `processed`-Marker bleibt als Redelivery-Shortcut (ADR-004-Update, Key-Lifecycle-/ACK-NACK-Tabelle, Worker-Reliability-Dashboard).

Offene Folge-Massnahmen (Analyse §9, vor dem naechsten grossen Lasttest):

- [x] Lokalen Lasttest als Baseline ausfuehren und Vorher-Zahlen fuer #5/#7 dokumentieren (`docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md`).
- [x] **#5 Reservation-Ledger (ZSet) statt Keyspace-SCAN:** Reconcile zaehlt via `ZCARD` (O(1)), Ablauf ist nur Stale-Kandidat statt Rueckbuchung — behebt das Baseline-A-Oversell-Risiko. → ADR-027, [Details](TODO-ARCHIVE.md#5-reservation-ledger-statt-keyspace-scan)

## Phase 4.7: Checkout & Payment-Simulation (Web + API)

Ziel: realistischer Checkout statt einzelnem `POST /buy`-Klick — Reservierung, Payment-Modal mit simuliertem 3DS, danach Live-Order-Status. Leitentscheidung: `/buy` reserviert nur, die synchrone Pay-Route published (ADR-028). → [Details](TODO-ARCHIVE.md#phase-47-ziel-und-leitentscheidung)

**Wo lebt die Payment-Latenz?** Nirgends im Backend — Worker-Sleep entfernt, `/pay` ohne Server-Sleep; die 3DS-Verzoegerung ist reines Frontend-UX. k6 faehrt `/buy`→`/pay` back-to-back (ADR-028). → [Details](TODO-ARCHIVE.md#wo-lebt-die-payment-latenz)

### Backend: Reserve/Pay-Split (`apps/api` + `packages/types`)

- [x] **Buy entkoppeln:** `POST /api/tickets/:eventId/buy` reserviert nur noch (Lua: `DECR available` + Ledger-`ZADD` + `pending`-Order) und liefert `orderId` + `202`, **ohne** Publish. → [Details](TODO-ARCHIVE.md#buy-entkoppeln)
- [x] **Payment-DTO in `packages/types`:** Zod-Schema fuer den simulierten Payment-Request/Response, klar als Fake gekennzeichnet, keine Persistenz der Zahlungsdaten. → [Details](TODO-ARCHIVE.md#payment-dto-in-packagestypes)
- [x] **Worker-Sleep entfernen:** 1-s-Payment-Mock samt `sleep`-Dependency aus `handle-buy-ticket-message.ts` geloescht; der Worker ist jetzt reiner Persist-Consumer. → [Details](TODO-ARCHIVE.md#worker-sleep-entfernen)
- [x] **Synchrone Pay-Route:** `POST /api/orders/:orderId/pay` validiert das DTO und published `BuyTicketEvent`, antwortet synchron mit `200` — kein Server-Sleep, keine DB-Writes. → [Details](TODO-ARCHIVE.md#synchrone-pay-route)
- [x] **Publish-Rollback im Pay-Pfad:** Schlaegt der Publish in der Pay-Route fehl, Reservation via bestehendem Gegen-Script freigeben (`ZREM` + `INCR available` + Pending-`DEL`) und Fehler zurueckliefern (analog zum alten Buy-Rollback). `publish_rollbacks_total` zaehlt jetzt den Pay-Rollback.
- [x] **Checkout-Abbruch/Timeout behandeln:** `POST /api/orders/:orderId/cancel` gibt die Ledger-Reservierung idempotent frei, sonst bliebe sie als Phantom-Anspruch stehen. → [Details](TODO-ARCHIVE.md#checkout-abbruch-und-timeout-behandeln)
- [x] **Metriken/Observability nachziehen:** E2E-Buckets auf die ms-Leiter zurueckgenommen (der Split misst nur noch Publish→Persist), Checkout-Funnel-Counter + Abandon-Rate-Panel ergaenzt. → [Details](TODO-ARCHIVE.md#metriken-und-observability-nachziehen)
- [x] **Tests:** Pay-Route (Happy/`404`/`409`/Rollback), Cancel-Route, Worker ohne Sleep und die E2E-Flows auf reserve→pay→Worker→Status umgestellt. → [Details](TODO-ARCHIVE.md#tests-zum-reservepay-split)
- [x] **ADR-028 + Doku-Lockstep:** ADR-028 angelegt, ADR-013/ADR-023 annotiert, `ARCHITECTURE.md` (Happy Path, Flow, Key-Lifecycle) und `REQUIREMENTS.md` (API-Surface) nachgezogen. → [Details](TODO-ARCHIVE.md#adr-028-und-doku-lockstep)

### Frontend: Checkout-Flow (`apps/web`)

- [x] **Auto-Fill Namen:** `apps/web/lib/names.ts` befuellt Vor-/Nachname beim Betreten der `open`-Phase mit Zufallsnamen, weiterhin editierbar. → [Details](TODO-ARCHIVE.md#auto-fill-namen)
- [x] **Payment-Modal:** Nach dem Reserve oeffnet `components/PaymentModal.tsx` (Tailwind-only) mit vorbefuellten Fake-Zahlungsdaten. → [Details](TODO-ARCHIVE.md#payment-modal)
- [x] **Fake-3DS-Challenge:** Modal-Statemachine `form → challenge → processing`; erst „Bestätigen“ ruft `POST /pay`, Fehler landen als Banner im Kartenformular. → [Details](TODO-ARCHIVE.md#fake-3ds-challenge)
- [x] **Modal-Abbruch:** Schliessen des Modals (X/Abbrechen/Backdrop/Escape) gibt die Reservierung idempotent frei; `onPaid` loest **keinen** Cancel aus. → [Details](TODO-ARCHIVE.md#modal-abbruch)
- [x] **Neue `tracking`-Phase:** `Phase`-Modell um `tracking` erweitert; nach bestaetigter Zahlung zeigt die neue `TrackingView` den Order-Status inline. → [Details](TODO-ARCHIVE.md#neue-tracking-phase)
- [x] **Live-Order-Status:** `hooks/useOrderStatus.ts` pollt (2 s + Jitter) bis zum Final-Status; `TrackingView` rendert `pending`/`completed`/`failed` live. → [Details](TODO-ARCHIVE.md#live-order-status)

## Backlog: Near-Term-Arbeit nach Phase 4.7 (Stage 2–4)

Aus den abgeschlossenen Phasen 4 / 4.5 / 4.6 hierher verschobene offene Tasks (nachtraeglich entdeckte Folgearbeit, vgl. append-forward-Regel). Reihenfolge = Roadmap. Wo der Payment-Split (Phase 4.7) die Praemisse geaendert hat, sind die Tasks neu gefasst.

### Stage 2 — DB-Hot-Row (naechster echter Limiter nach dem Sleep-Removal)

- [x] **#7 isoliert benchmarken:** Micro-Bench `pnpm bench:hot-row` weist den `sold_count`-Hot-Row als Limiter nach — 235 tickets/s bei 49/50 Backends im Lock-Wait. → [Details](TODO-ARCHIVE.md#7-isoliert-benchmarken)
- [x] **#7 `buy_ticket` ohne `sold_count`-Hot-Row:** Verkaufsstand via `COUNT(tickets)` im Reconcile aggregiert (Migration 0009) — 26.385 tickets/s bei 0 Lock-Wait (~112×). → ADR-011-Update, [Details](TODO-ARCHIVE.md#7-buy_ticket-ohne-sold_count-hot-row)

### Stage 3 — Pre-Baseline-Cleanups (guenstig, vor dem Kapazitaetslauf buendeln)

- [x] **#9 Pub/Sub-Provisioning nach `scripts/local`:** duplizierte In-Plugin-Create-Maschinerie und die `*Like`-Schattentypen entfernt; API und Worker sind reine Runtime-Clients. → [Details](TODO-ARCHIVE.md#9-pubsub-provisioning-nach-scriptslocal)
- [x] **Sale-Unlock-Gate gegen echtes Redis testen:** Integrationstest fuehrt `RESERVE_TICKET_SCRIPT` gegen `hts-redis` aus (alle vier Gate-Faelle + Sold-Out). → ADR-024-Nachtrag, [Details](TODO-ARCHIVE.md#sale-unlock-gate-gegen-echtes-redis-testen)
- [x] **`409`/`425` und die neuen Pay/Cancel-Fehler im Response-Schema deklarieren:** wiederverwendbare Fabrik `httpErrorResponseSchema` statt Copy-Paste. → [Details](TODO-ARCHIVE.md#fehler-response-schemas-fuer-buy-pay-und-cancel)
- [x] **k6-Checkout-Funnel (Blocker fuer Baseline B):** `runCheckout()` faehrt buy → pay → optionalen Status-Poll; das alte `/buy`-only-Skript publizierte seit ADR-028 nie. → [Details](TODO-ARCHIVE.md#k6-checkout-funnel-blocker-fuer-baseline-b)
- [x] **Abandonment + Think-Time im Funnel modellieren:** ~88 % pay / ~8 % cancel / ~4 % Abbruch, Denkzeit als k6-`sleep()` in zwei Profilen (capacity/realism). → [Details](TODO-ARCHIVE.md#abandonment-und-think-time-im-funnel)
- [x] **Sold-Out-Erkennung im Orchestrator korrigieren:** Plateau des monotonen `orders_completed_total` statt des oszillierenden `available` (Cancels machen `INCR`). → ADR-025-Nachtrag, [Details](TODO-ARCHIVE.md#sold-out-erkennung-im-orchestrator-korrigieren)
- [x] **k6-Metriken nach Endpoint, Status und Transportfehlerklasse:** Funnel-Counter, `requests_by_status{endpoint,status}` und `transport_errors{endpoint,error_code}`. → [Details](TODO-ARCHIVE.md#k6-metriken-nach-endpoint-status-und-fehlerklasse)

### Stage 4 — Echter Kapazitaetsnachweis (System jetzt sleeplos + Hot-Row-optimiert)

- [x] **Dedizierter LoadTest-Run gegen gebauten Stand:** `start:loadtest` in API und Worker (gebaut, ohne `-P`/pino-pretty, ohne `tsc-watch`) statt `pnpm dev`. → [Details](TODO-ARCHIVE.md#dedizierter-loadtest-run-gegen-gebauten-stand)
- [x] **Request-Logging abschaltbar machen:** Env-Flag `DISABLE_REQUEST_LOGGING` (Enum statt `z.coerce.boolean()`) haengt an `disableRequestLogging` in beiden `app.ts`. → [Details](TODO-ARCHIVE.md#request-logging-fuer-den-lasttest-abschaltbar-machen)
- [x] **Worker-Resubscribe nach Seed/Reset (Baseline-B-Blocker):** `reset-seed.mjs` loeschte die Subscription unter dem laufenden Worker; sie wird jetzt idempotent angelegt. → [Details](TODO-ARCHIVE.md#worker-resubscribe-nach-seedreset)
- [x] **MVP der Report-Automation umgesetzt:** `scripts/load-test/` (pur/side-effecting getrennt), Kommandos `spike:report`/`:analyze`/`:compare`, 47 Tests + Goldens. → [Details](TODO-ARCHIVE.md#mvp-der-report-automation)
- [ ] Trenne den Lastgenerator vom System-under-Test bzw. nutze einen verteilten Runner; dimensioniere fuer das 50k-RPS-Ziel mindestens ~20k aktive VUs und fordere 0 dropped iterations fuer einen gueltigen Kapazitaetsnachweis.
- [x] **Baseline B ausgefuehrt (2026-07-26):** `benchmark=invalid` (67,66 % dropped, Generator-Saturation), fachlich korrekt: 867.575 Orders, 0 Verlust, E2E 406 s → 7,52 s. → [Details](TODO-ARCHIVE.md#baseline-b-lauf)
- [x] **Sold-Out-Fehlalarm durch stale Completion-Counter (Korrektur zu #235):** `orders_completed_total` ueberlebt `reset-seed`; das Plateau zaehlt jetzt relativ zur ersten Poll-Baseline. → [Details](TODO-ARCHIVE.md#sold-out-fehlalarm-durch-stale-completion-counter)

## Phase 4.8: API-Performance-Dashboard — fehlende Order-Routen

> Nachtrag zum Phase-4.5-Todo „Grafana-Dashboard: API Performance“: die Order-Routen `/pay` und `/cancel` fehlen als eigene Graphen, obwohl `http_request_duration_seconds` sie per `route`-Label bereits exponiert. → [Details](TODO-ARCHIVE.md#phase-48-nachtrag-zum-api-performance-dashboard)

- [ ] Ergänze im Panel „Request Rate (RPS)" je eine Serie fuer `route="/api/orders/:orderId/pay"` und `route="/api/orders/:orderId/cancel"` (analog zu den bestehenden buy-/availability-Serien: `sum(rate(http_request_duration_seconds_count{job="api", route="…"}[1m]))`).
- [ ] Füge ein Panel „POST /pay Latency (p50 / p95 / p99)" hinzu, das das bestehende `/buy`-Latenz-Panel fuer `route="/api/orders/:orderId/pay"` spiegelt (`histogram_quantile(…, sum by (le) (rate(http_request_duration_seconds_bucket{job="api", route="/api/orders/:orderId/pay"}[1m])))`).
- [ ] Füge analog ein Panel „POST /cancel Latency (p50 / p95 / p99)" fuer `route="/api/orders/:orderId/cancel"` hinzu.
- [ ] Verifiziere nach dem Import in Grafana, dass die neuen Serien unter Last (`pnpm spike`) tatsaechlich Daten liefern und die `route`-Label-Werte exakt den Fastify-Templates entsprechen (kein Fallback auf Roh-URL — siehe `apps/api/src/plugins/metrics.ts`).

## Phase 5: Cloud Deployment (GCP)

- [ ] Erstelle Terraform-Skripte für VPC, Cloud SQL, Memorystore und GKE.
- [ ] Erstelle Dockerfiles für API, Worker und Web.
- [ ] Schreibe Kubernetes Deployment/Service/Ingress Manifeste.
- [ ] Führe Cloud-Lasttest aus und sammle Metriken für die README.
- [ ] **Sale-Unlock-Zeitquelle bei `API replicas > 1` (ADR-024):** das Gate vergleicht gegen `Date.now()` der API, nicht gegen `redis.call("TIME")` — der Unlock ist nur so praezise wie die Pod-Uhren. → [Details](TODO-ARCHIVE.md#sale-unlock-zeitquelle-bei-mehreren-api-replicas)

### Phase 5: Reconcile-Loop HA-Eskalation (bei `replicas > 1`)

Wenn der Worker horizontal skaliert wird, darf nur ein Pod reconcilieren. Zwei Optionen (ADR-022):

- [ ] **Option A – K8s Lease API:** Leader Election via `coordination.k8s.io/v1 Lease`-Objekt implementieren. Nur der Leader-Pod startet den Reconcile-Loop; alle anderen ueberspringen ihn. (Dieselbe Mechanik wie `kube-controller-manager` in HA-Setups.)
- [ ] **Option B – Dedizierter Reconciler-Service:** `apps/reconciler` als eigenstaendigen Singleton-Service auslagern. Laeuft als `replicas: 1`, voellig unabhaengig vom Worker-Scaling. Klare Separation of Concerns, erhoehte Deployment-Komplexitaet.
- [ ] Entscheidung zwischen Option A und B treffen, sobald Worker-Skalierung konkret geplant ist, und ADR-022 aktualisieren.

## Phase 6: Optional & Resilience (Maximum Learning)

- [ ] Fuehre danach ein Storage-Review fuer den Order-Flow durch: Redis-/DB-Footprint pro Order messen, TTL-/Key-Strategie bewerten und konkrete Optimierungen fuer Speicherbedarf und Key-Anzahl priorisieren.
- [ ] Implementiere Dead Letter Queue (DLQ) in Pub/Sub und einen Retry/Replay-Mechanismus im Worker.
- [ ] Implementiere Idempotency Keys für die Ticket-Kauf-Route (API & DB) um doppelte Käufe zu verhindern.
- [ ] Füge Rate Limiting in Fastify (via Redis) als Bot-Protection hinzu.
- [ ] Integriere den k6 Lasttest als Quality Gate in GitHub Actions (Fail bei großer Latenz oder hohen Error-Rates).
- [ ] Simuliere Chaos Engineering (z.B. Redis oder Worker Ausfälle während des Lasttests) um zu testen, ob das System graceful degradiert.
- [ ] Definiere Polling-Strategie fuer Order-Status (Backoff + Jitter, optional Long-Polling) zur Load-Reduktion.
- [ ] Konfiguriere `maxDeliveryAttempts` + Dead-Letter Topic pro Subscription, um Retry-Stuerme zu begrenzen.
- [ ] Definiere klare Poison-Message-Policy (ACK+DLQ vs. NACK) fuer invalides JSON, Schema-Fehler und unbekannte Event-Versionen.
- [ ] Implementiere Worker-Graceful-Shutdown mit Drain-Verhalten (in-flight Messages abschliessen; Processing-Locks existieren seit dem ADR-004-Update 2026-07-14 nicht mehr).
- [ ] **Reaper-Job fuer stale `pending` Orders und Ledger-Reservationen:** Kandidaten via `ZRANGEBYSCORE` auf dem Ledger; Rueckgewinnung nur nach Order-/Queue-Recovery, nicht allein wegen Alter. → [Details](TODO-ARCHIVE.md#reaper-job-fuer-stale-pending-orders-und-ledger-reservationen)
- [ ] Erstelle Replay-Tooling fuer DLQ-Nachrichten (selektiver Replay nach Fehlerklasse, Dry-Run-Modus).
- [ ] Definiere SLOs + Alerting fuer Resilience-Signale (NACK-Rate, Redelivery-Rate, DLQ-Groesse, stuck pending orders).
- [ ] Dokumentiere Incident-Runbook fuer Queue-Backlog, Redis-Ausfall und DB-Partial-Outage (Detection, Mitigation, Recovery).
- [ ] Schließe die letzte Ausnahme in `apps/web` (`check-types`) auf `tsgo`, sobald Side-Effect-CSS-Imports (`./globals.css`) im Native-Preview kompatibel sind.
- [ ] Migriere Dev-Watch-Restart-Flow von `tsc-watch` auf einen `tsgo`-basierten Restart-Workflow (API + Worker).

## Backlog: Baseline-B-Nachlauf (entdeckt 2026-07-26)

Aus dem Baseline-B-Lauf neu entdeckte Arbeit, nach der append-forward-Regel bewusst hier statt rueckwirkend in Stage 3/4. **Reihenfolge = Prioritaet:** P0 blockiert die Auswertbarkeit, P2 die Kapazitaetsaussage. → [Details](TODO-ARCHIVE.md#backlog-baseline-b-nachlauf-vorspann)

### P0 — Messkette reparieren (sonst ist auch Baseline C nicht auswertbar)

- [x] **Drain-Formel auf den Publish-Zeitpunkt umstellen (Report §4.4):** `pending` rechnete gegen `orders_accepted_total`, das schon beim Reserve steigt — Drain konnte nie 0 erreichen. Jetzt `payments_confirmed_total`. → [Details](TODO-ARCHIVE.md#drain-formel-auf-den-publish-zeitpunkt-umstellen)
- [x] **Invariante `dbTickets == completed` redelivery-tolerant fassen (Report §4.3):** Ursache behoben statt Invariante aufgeweicht — Finalize-Lua meldet Erst-Finalisierung, Duplikate zaehlen auf `worker_duplicate_deliveries_total`. → [Details](TODO-ARCHIVE.md#invariante-dbtickets-gleich-completed)
- [x] **Labeled Counter beim Boot auf 0 initialisieren (Report §4.2):** bewusst im Analyzer geloest (`resolveCounter`) statt in den Services — Vorinitialisieren haette der API einen PostgreSQL-Read aufgezwungen. → [Details](TODO-ARCHIVE.md#labeled-counter-ohne-baseline-im-snapshot)

### P1 — Messumgebung

- [x] **Prometheus stirbt am k6-Remote-Write (Report §4.1):** Remote-Write ist jetzt opt-in (`K6_PROMETHEUS_RW`) und im Default aus — der Report liest ohnehin keine k6-Serien. → [Details](TODO-ARCHIVE.md#prometheus-stirbt-am-k6-remote-write)
- [x] **Config-Snapshot aus den Services statt aus dem Orchestrator (Report §2):** neuer Gauge `service_config_info`; der Report weist Harness- und effektive Service-Config getrennt aus. → [Details](TODO-ARCHIVE.md#config-snapshot-aus-den-services-ziehen)
- [x] **Plateau-Detektor gegen Host-Contention haerten (Report §4.5):** das Plateau wird gegen den Rest-Bestand klassifiziert — `available == 0` → `sold-out`, sonst `stalled`. → ADR-025-Nachtrag, [Details](TODO-ARCHIVE.md#plateau-detektor-gegen-host-contention-haerten)

### P2 — Kapazitaet

- [ ] **Baseline C erst nach P0/P1 fahren.** Voraussetzung bleibt Stage-4-Todo #244 (Generator vom SUT trennen): Baseline B verwarf 67,66 % der Iterationen bei `maxVUs: 10000`. → [Details](TODO-ARCHIVE.md#baseline-c-nach-p0-und-p1)

### Beobachtung fuer das Storage-Review (Phase 6)

- [ ] **Datenbasis aus Baseline B in das Storage-Review einspeisen:** Redis 1.777.916 Keys / 505 MB fuer 867.575 Orders (~582 B/Order), PostgreSQL 246 MB, 43.066 Ledger-Phantoms. → [Details](TODO-ARCHIVE.md#datenbasis-aus-baseline-b-fuer-das-storage-review)

## Backlog: Report-Automation cloud-faehig machen (Vorbedingung fuer den GCP-Lasttest)

Beim Baseline-B-Nachlauf entdeckt: die Report-Automation ist **lokal-only**. Eigener Abschnitt, weil diese Punkte Terraform/GKE-Kontext brauchen und erst nach gemeinsamer GCP-Einarbeitung drankommen. → [Details](TODO-ARCHIVE.md#backlog-report-automation-cloud-faehig-vorspann)

- [ ] **State-Snapshots gegen Cloud SQL / Memorystore:** `snapshots.mjs` ist auf `docker exec hts-postgres`/`hts-redis` hart verdrahtet; braucht einen austauschbaren Zugriffspfad. → [Details](TODO-ARCHIVE.md#state-snapshots-gegen-cloud-sql-und-memorystore)
- [ ] **Preflight umgebungsabhaengig machen:** `preflight()` verlangt die lokalen Container und bricht im Cloud-Lauf ab; `requiredContainers` gibt es schon, ein Cloud-Profil fehlt. → [Details](TODO-ARCHIVE.md#preflight-umgebungsabhaengig-machen)
- [ ] **Seed-Pfad fuer die Cloud:** `reset-seed.mjs` nutzt Emulator-REST und Container-CLI; in GCP provisioniert Terraform. Klaeren, ob ein Cloud-Lauf ueberhaupt seeden darf. → [Details](TODO-ARCHIVE.md#seed-pfad-fuer-die-cloud)
- [ ] **Verteilten k6-Runner orchestrieren:** `spawnK6` startet genau einen lokalen Prozess; fuer 50k RPS braucht es mehrere Knoten und ein Merge der Teil-Summaries. Haengt an #244. → [Details](TODO-ARCHIVE.md#verteilten-k6-runner-orchestrieren)
- [ ] **Monitoring-Quelle fuer den Cloud-Lauf entscheiden:** Managed Prometheus, selbst betriebener Prometheus im Cluster oder Cloud Monitoring — und wie `targetUp`/Range-Queries darauf abbilden. → [Details](TODO-ARCHIVE.md#monitoring-quelle-fuer-den-cloud-lauf)
