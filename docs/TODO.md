# Implementation Roadmap: High-Frequency Ticket System

Die Phasen sind der rote Faden des Projekts und werden von oben nach unten
gelesen: oben abgeschlossen, unten offen. Eine neue Phase wird direkt nach der
aktuell aktiven Phase eingefügt, nie am Dateiende (siehe `AGENTS.md`).

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
- [x] Dokumentiere reproduzierbare Diagnoseablaeufe im [Runbook](RUNBOOK.md#8-debugging).
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

## Phase 3.1: Flow Hardening (Korrektheit + Performance)

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

Details: [phase-4-load-tests](notes/phases/phase-4-load-tests.md)

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
- [x] Fuehre den lokalen Baseline-A-Lasttest aus und dokumentiere Bottlenecks. → [Report](reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md)
- [x] Erzeuge Screenshots der Dashboards unter extremer Last fuer die README.
- [x] Sale-Unlock-Gate atomar in Redis umsetzen und im Seed konfigurierbar machen. → [ADR-024](decisions/ADR-024-sale-unlock-gate-425-too-early.md)
- [x] **Reaktive Sold-Out-Erkennung im Lasttest:** `spike-phase-a/b.js`, orchestriert von `run-spike.mjs` statt fixer Phasen-Timer — Baseline A endete sonst mitten im Peak. → ADR-025
- [x] Dokumentiere und implementiere die automatisierbare Evidence-/Report-Pipeline inkl. Validitaetsregeln und Artefaktvertrag (`scripts/load-test/README.md`).

## Phase 4.1: Monitoring & Observability

Details: [phase-4-1-observability](notes/phases/phase-4-1-observability.md)

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
- [x] **Dashboard-PromQL gegen fehlende Zero-Serien haerten:** jeder potenziell fehlende Operand mit `or vector(0)` umschlossen, damit gesundes Null nicht als `No data` verschwindet.
- [x] **E2E-Latenz und Throughput-Panel korrigieren:** Buckets bis 600 s, ehrliche Ratio-Bezeichnung und `last` statt Legendensumme. → ADR-023
- [x] **`redis_exporter` + DB-/Runtime-Bottleneck-Metriken:** Pool-Wait, Query-Latency und Lock-Wait aus dem Worker, sichtbar im Dashboard „DB & Runtime“. → ADR-026

## Phase 4.2: Standard-Flow-Optimierung (vgl. `docs/reports/ANALYSIS-STANDARD-FLOW.md`)

Risikoarme Massnahmen (Analyse §9, Nr. 1/2/6/8/10) und der Handler-Block (Nr. 3/4) — umgesetzt:

Details: [phase-4-2-standard-flow](notes/phases/phase-4-2-standard-flow.md)

- [x] #10: Redis-Typ-Schatten/Casts durch zentrales `@repo/types/redis-client` ersetzen; Zod-Parse selbst konstruierter Literale durch `satisfies` (Zod bleibt an allen externen Grenzen).
- [x] #1: Reserve+Reservation+Pending-Order als **ein** atomares Lua-Script via ioredis `defineCommand`/EVALSHA; Publish-Rollback als idempotentes Gegen-Script (3→1 RTT, ADR-005-Update).
- [x] #2: Worker Idempotenz-Check+Lock als ein Script (`beginOrderProcessing`), Finalisierung (Order-Cache + `processed`-Marker + Lock-Release) als ein Script (5→2 RTT pro Message, ACK/NACK-Semantik unveraendert).
- [x] #6: Reconcile korrigiert `available` als Delta (`INCRBY`) statt absolutem `MSET` (schliesst das Lost-Decrement-Fenster); `redis_db_drift_tickets`-Gauge (ADR-023) verdrahtet.
- [x] #8: `PUBSUB_FLOW_CONTROL_MAX_MESSAGES` (Default 500) und `DATABASE_POOL_MAX` (Default 20) als explizite, aufeinander abgestimmte Env-Knobs (siehe ARCHITECTURE.md "Worker-Durchsatz & Backpressure").
- [x] #3: Handler liefert `BuyTicketOutcome`-Wert; ACK/NACK + Metriken als Policy-Tabelle (`buyTicketOutcomePolicy`) im Listener — die Doku-Tabelle ist woertlich Code, ack/nack genau einmal pro Nachricht.
- [x] #4: `processing`-Lock gestrichen — Idempotenz traegt die `buy_ticket`-DB-Transaktion (ON CONFLICT); `processed`-Marker bleibt als Redelivery-Shortcut (ADR-004-Update, Key-Lifecycle-/ACK-NACK-Tabelle, Worker-Reliability-Dashboard).

Offene Folge-Massnahmen (Analyse §9, vor dem naechsten grossen Lasttest):

- [x] Lokalen Lasttest als Baseline ausfuehren und Vorher-Zahlen fuer #5/#7 dokumentieren (`docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md`).
- [x] **#5 Reservation-Ledger (ZSet) statt Keyspace-SCAN:** Reconcile zaehlt via `ZCARD` (O(1)), Ablauf ist nur Stale-Kandidat statt Rueckbuchung — behebt das Baseline-A-Oversell-Risiko. → ADR-027

## Phase 4.3: Checkout & Payment-Simulation (Web + API)

Ziel: Reservierung, simuliertes 3DS und Live-Status. `/buy` reserviert; erst `/pay` publiziert (ADR-028). → [Details](notes/phases/phase-4-3-checkout.md#phase-43-ziel-und-leitentscheidung)

**Wo lebt die Payment-Latenz?** Nirgends im Backend — Worker-Sleep entfernt, `/pay` ohne Server-Sleep; die 3DS-Verzoegerung ist reines Frontend-UX. k6 faehrt `/buy`→`/pay` back-to-back (ADR-028). → [Details](notes/phases/phase-4-3-checkout.md#wo-lebt-die-payment-latenz)

### Backend: Reserve/Pay-Split (`apps/api` + `packages/types`)

- [x] **Buy entkoppeln:** `POST /api/tickets/:eventId/buy` reserviert nur noch (Lua: `DECR available` + Ledger-`ZADD` + `pending`-Order) und liefert `orderId` + `202`, **ohne** Publish.
- [x] **Payment-DTO in `packages/types`:** Zod-Schema fuer den simulierten Payment-Request/Response, klar als Fake gekennzeichnet, keine Persistenz der Zahlungsdaten.
- [x] **Worker-Sleep entfernen:** 1-s-Payment-Mock samt `sleep`-Dependency aus `handle-buy-ticket-message.ts` geloescht; der Worker ist jetzt reiner Persist-Consumer.
- [x] **Synchrone Pay-Route:** `POST /api/orders/:orderId/pay` validiert das DTO und published `BuyTicketEvent`, antwortet synchron mit `200` — kein Server-Sleep, keine DB-Writes.
- [x] **Publish-Rollback im Pay-Pfad:** Bei Publish-Fehler den Reservierungsanspruch atomar und idempotent freigeben. → [ADR-028](decisions/ADR-028-reserve-pay-publish-split-payment-latenz-lebt-im-frontend.md)
- [x] **Checkout-Abbruch/Timeout behandeln:** `POST /api/orders/:orderId/cancel` gibt die Ledger-Reservierung idempotent frei, sonst bliebe sie als Phantom-Anspruch stehen.
- [x] **Observability nachziehen:** E2E misst Publish→Persist; Checkout-Funnel und Abandon-Rate ergänzt.
- [x] **Tests:** Pay-Route (Happy/`404`/`409`/Rollback), Cancel-Route, Worker ohne Sleep und die E2E-Flows auf reserve→pay→Worker→Status umgestellt.
- [x] **ADR-028 + Doku-Lockstep:** ADR-028 angelegt, ADR-013/ADR-023 annotiert, `ARCHITECTURE.md` (Happy Path, Flow, Key-Lifecycle) und `REQUIREMENTS.md` (API-Surface) nachgezogen.

### Frontend: Checkout-Flow (`apps/web`)

- [x] **Auto-Fill Namen:** `apps/web/lib/names.ts` befuellt Vor-/Nachname beim Betreten der `open`-Phase mit Zufallsnamen, weiterhin editierbar.
- [x] **Payment-Modal:** Nach dem Reserve oeffnet `components/PaymentModal.tsx` (Tailwind-only) mit vorbefuellten Fake-Zahlungsdaten.
- [x] **Fake-3DS-Challenge:** Modal-Statemachine `form → challenge → processing`; erst „Bestätigen“ ruft `POST /pay`, Fehler landen als Banner im Kartenformular.
- [x] **Modal-Abbruch:** Schliessen des Modals (X/Abbrechen/Backdrop/Escape) gibt die Reservierung idempotent frei; `onPaid` loest **keinen** Cancel aus.
- [x] **Neue `tracking`-Phase:** `Phase`-Modell um `tracking` erweitert; nach bestaetigter Zahlung zeigt die neue `TrackingView` den Order-Status inline.
- [x] **Live-Order-Status:** `hooks/useOrderStatus.ts` pollt (2 s + Jitter) bis zum Final-Status; `TrackingView` rendert `pending`/`completed`/`failed` live.

## Phase 4.4: Weg zur Baseline B (Folgearbeit aus Phase 4–4.2)

Nach dem Reserve/Pay-Split gebündelte Folgearbeit aus den Phasen 4–4.2: erst den `sold_count`-Hot-Row als nächsten Limiter entfernen, dann günstige Cleanups, dann der Kapazitätsnachweis (Baseline B).

Details: [stage-2-db-hot-row](notes/backlogs/stage-2-db-hot-row.md) · [stage-3-pre-baseline-cleanups](notes/backlogs/stage-3-pre-baseline-cleanups.md) · [stage-4-capacity-evidence](notes/backlogs/stage-4-capacity-evidence.md) · [local-generator-split](notes/backlogs/local-generator-split.md)

### DB-Hot-Row (nächster echter Limiter nach dem Sleep-Removal)

- [x] **#7 isoliert benchmarken:** Micro-Bench `pnpm bench:hot-row` weist den `sold_count`-Hot-Row als Limiter nach — 235 tickets/s bei 49/50 Backends im Lock-Wait.
- [x] **#7 `buy_ticket` ohne `sold_count`-Hot-Row:** Verkaufsstand via `COUNT(tickets)` im Reconcile aggregiert (Migration 0009) — 26.385 tickets/s bei 0 Lock-Wait (~112×). → ADR-011

### Pre-Baseline-Cleanups (günstig, vor dem Kapazitätslauf gebündelt)

- [x] **#9 Pub/Sub-Provisioning nach `scripts/local`:** Runtime-Clients von Provisioning und `*Like`-Schattentypen befreit.
- [x] **Sale-Unlock-Gate gegen echtes Redis testen:** alle Gate-Fälle plus Sold-Out abgedeckt. → ADR-024
- [x] **`409`/`425` und die neuen Pay/Cancel-Fehler im Response-Schema deklarieren:** wiederverwendbare Fabrik `httpErrorResponseSchema` statt Copy-Paste.
- [x] **k6-Checkout-Funnel:** `runCheckout()` fährt buy → pay → optionalen Status-Poll.
- [x] **Abandonment + Think-Time im Funnel modellieren:** ~88 % pay / ~8 % cancel / ~4 % Abbruch, Denkzeit als k6-`sleep()` in zwei Profilen (capacity/realism).
- [x] **Sold-Out-Erkennung korrigieren:** Plateau von `orders_completed_total` statt `available`. → ADR-025
- [x] **k6-Metriken klassifizieren:** Funnel, Endpoint/Status und Transportfehler.

### Kapazitätsnachweis (System jetzt sleeplos + Hot-Row-optimiert)

- [x] **Dedizierter LoadTest-Run gegen gebauten Stand:** `start:loadtest` in API und Worker (gebaut, ohne `-P`/pino-pretty, ohne `tsc-watch`) statt `pnpm dev`.
- [x] **Request-Logging abschaltbar machen:** `DISABLE_REQUEST_LOGGING` für API und Worker.
- [x] **Worker-Resubscribe nach Seed/Reset:** Subscription wird idempotent wiederhergestellt.
- [x] **MVP der Report-Automation umgesetzt:** `scripts/load-test/` (pur/side-effecting getrennt), Kommandos `spike:report`/`:analyze`/`:compare`, 47 Tests + Goldens.
- [x] ~~Generator vom SUT trennen fuer 50k RPS (~20k VUs, 0 dropped).~~ **Verworfen 2026-08-14:** per REQ-P02 ein Cloud-Ziel (→ Phase 4.11 + 5); lebt lokal in Phase 4.12 weiter.
- [x] **Baseline B ausgefuehrt (2026-07-26):** `benchmark=invalid` (67,66 % dropped, Generator-Saturation), fachlich korrekt: 867.575 Orders, 0 Verlust, E2E 406 s → 7,52 s.
- [x] **Sold-Out-Fehlalarm durch alten Completion-Counter:** Plateau zählt relativ zur Poll-Baseline.

## Phase 4.5: Baseline-B-Nachlauf (entdeckt 2026-07-26)

Folgearbeit aus Baseline B; P0 blockierte die Auswertung, P2 die Kapazitätsaussage. → [Details](notes/backlogs/baseline-b-overview.md#backlog-baseline-b-nachlauf-vorspann)

Details: [baseline-b-measurement-chain](notes/backlogs/baseline-b-measurement-chain.md) · [baseline-b-environment](notes/backlogs/baseline-b-environment.md) · [baseline-b-capacity](notes/backlogs/baseline-b-capacity.md) · [baseline-b-storage-review](notes/backlogs/baseline-b-storage-review.md)

### P0 — Messkette reparieren (sonst ist auch Baseline C nicht auswertbar)

- [x] **Drain-Formel auf Publish umstellen:** `payments_confirmed_total` statt Reserve-Counter.
- [x] **`dbTickets == completed` redelivery-tolerant machen:** Erst-Finalisierung und Duplikate getrennt zählen.
- [x] **Fehlende Counter-Baseline behandeln:** `resolveCounter` im Analyzer statt DB-Read in der API.

### P1 — Messumgebung

- [x] **Prometheus stirbt am k6-Remote-Write (Report §4.1):** Remote-Write ist jetzt opt-in (`K6_PROMETHEUS_RW`) und im Default aus — der Report liest ohnehin keine k6-Serien.
- [x] **Config-Snapshot aus den Services statt aus dem Orchestrator (Report §2):** neuer Gauge `service_config_info`; der Report weist Harness- und effektive Service-Config getrennt aus.
- [x] **Plateau-Detektor gegen Host-Contention haerten (Report §4.5):** das Plateau wird gegen den Rest-Bestand klassifiziert — `available == 0` → `sold-out`, sonst `stalled`. → ADR-025

### P2 — Kapazitaet

- [x] **Baseline C erst nach P0/P1 fahren.** Superseded 2026-08-14: der Lauf erfolgte 2026-07-26 abends (benchmark-invalid, 21,85 % dropped); der gueltige Lauf lebt in Phase 4.12.

### Beobachtung fuer das Storage-Review (Phase 6)

- [x] **Datenbasis aus Baseline B in das Storage-Review einspeisen:** nach Phase 6 verschoben — das Storage-Review-Todo verlinkt die Datenbasis jetzt direkt.

## Phase 4.6: Baseline-C-Nachlauf (entdeckt 2026-07-26 abends)

Aus dem Baseline-C-Lauf: die Messketten-Fixes des B-Nachlaufs haben gehalten, der Lauf legte echte System- und Dashboard-Defekte frei. → [Report](reports/baseline-c-2026-07-26/LOAD-TEST-REPORT-2026-07-26.md), [Vorspann](notes/backlogs/baseline-c-overview.md#backlog-baseline-c-nachlauf-vorspann)

Details: [baseline-c-correctness](notes/backlogs/baseline-c-correctness.md) · [baseline-c-capacity](notes/backlogs/baseline-c-capacity.md) · [local-generator-split](notes/backlogs/local-generator-split.md) · [baseline-c-dashboard-audit](notes/backlogs/baseline-c-dashboard-audit.md)

### P0 — Korrektheit

- [x] **Reconcile-Leseordnung umdrehen (Report §5):** DB-vor-Ledger-Read erfand Inventar (389 Ansprueche > Kapazitaet); jetzt Ledger vor DB, damit die Korrektur konservativ nach unten irrt. → ADR-022
- [x] **Drift-Gauge entklammern (Report §5):** `Math.max(…, 0)` machte `redis_db_drift_tickets` genau bei Ueberzeichnung blind; Klammer nur noch am Redis-Write, Metrik aus dem ungeklammerten Erwartungswert.

### P1 — Kapazitaet weitertreiben

- [x] **`DATABASE_POOL_MAX` erhöhen und neu messen:** Config erledigt (`start:loadtest` setzt Pool 50); der 2026-08-03-Lauf war generator-verzerrt, die gueltige Messung ist Teil des 4.12-Laufs.
- [x] **k6-`maxVUs` und Zielrate in Einklang bringen:** 5.000 VUs bei 10.000 Iterationen/s garantierten Verwerfungen rechnerisch; `maxVUs` auf 10.000 (deckt ~1 s Iterationsdauer).
- [x] **Transportfehler untersuchen:** Hypothese Host-Netzwerkgrenzen; wird durch den 4.12-Lauf mit getrenntem Generator entschieden — bleiben sie, folgt ein neues Todo.

### P2 — Dashboard-Audit (alle 8 Dashboards, 2026-07-26)

Leitfehler: Panels lasen Reserve als Publish. → [Vorspann](notes/backlogs/baseline-c-dashboard-audit.md#dashboard-audit-vorspann), [korrekt geprüft](notes/backlogs/baseline-c-dashboard-audit.md#dashboard-audit-als-korrekt-geprueft)

- [x] **`order-lifecycle`: Pending, Ratio und Counts** auf `payments_confirmed_total` korrigiert.
- [x] **`order-lifecycle`: „Checkout Abandon Rate" lieferte −7,33 %** — 5m-Fenster statt Lauf; jetzt `$__range` + `clamp_min`, live 12,1 % (modelliert 12 %).
- [x] **`pubsub-queue`: Publish Rate und Queue Depth** lasen `accepted` statt Publish und ueberschaetzten die Tiefe; `worker_duplicate_deliveries_total` fehlte.
- [x] **`api-performance`: `/pay` und `/cancel` ohne eigene Panels** — der Publish-Pfad war unsichtbar; RPS-Serien + Pay-Latenz-Panel ergaenzt (p95 4,55 s im Crunch).
- [x] **`api-performance`: Error Rate ignorierte `425`** (29.965 Warm-up-Versuche) und mischte die mehrdeutigen 409 global.
- [x] **`reservation-consistency`: „Current Drift" nutzte `abs()`** und verwarf das Vorzeichen — genau die Oversell-Information.
- [x] **`reservation_ledger_active`/`_stale` in keinem Dashboard:** das Reaper-Signal war unsichtbar, obwohl es 4,3 % des Inventars band; neues Panel.
- [x] **`worker-reliability`: Duplicate Deliveries fehlten,** Rate-Nenner war `accepted` statt `payments_confirmed`.
- [x] **`order-completion-latency`: Panel-Titel seit ADR-028 falsch** — gemessen wird Publish→Persist, nicht `/buy`→completed.
- [x] **`redis-performance`: „Memory Usage" plottete `redis_memory_max_bytes`** (ohne `maxmemory` konstant 0, sah wie ein Defekt aus) → Serie entfernt, bewusst kein `maxmemory`.
- [x] **`db-runtime`: Pool Wait/Lock Waits waren Momentaufnahmen** und zeigten nach dem Lauf 0 → `max_over_time([$__range])`; echter Peak 3.578 wartende Acquirer.

## Phase 4.7: API-Performance-Dashboard — fehlende Order-Routen

> `/pay` und `/cancel` fehlen im API-Performance-Dashboard als eigene Graphen. → [Details](notes/phases/phase-4-7-api-performance.md#phase-47-nachtrag-zum-api-performance-dashboard)

Umgesetzt im Dashboard-Audit des Baseline-C-Nachlaufs. → [Umsetzungsstand](notes/phases/phase-4-7-api-performance.md#umsetzungsstand-2026-07-26)

- [x] Request-Rate-Serien `POST /pay RPS` und `POST /cancel RPS` im Panel „Request Rate (RPS)".
- [x] Panel „POST /pay Latency (p50 / p95 / p99)" ergaenzt; Pay-p95 im Crunch 4,55 s gegen Buy 874 ms.
- [x] Kein eigenes `/cancel`-Latenzpanel — „Latency by Route (p50 / p95)" deckt es generisch ab, analog zum ebenfalls weggelassenen `GET /orders/:orderId`.
- [x] Serien gegen Baseline-C-Daten verifiziert; die `route`-Labels entsprechen den Fastify-Templates.

## Phase 4.8: Belegerhebung & Entwickler-Werkzeug (entdeckt 2026-07-27)

Kleinteilige Verbesserungen am Lasttest-Werkzeug, die beim Fahren der Baseline-D-Vorbereitung aufgefallen sind.

- [x] **Grafana-Panels als PNG exportieren:** alle 48 Panels reproduzierbar im Run-Verzeichnis. → ADR-030, [RUNBOOK §5](RUNBOOK.md#5-auswertung-braucht-keinen-laufenden-stack)
- [x] **Web im Lasttest-Stack mitstarten:** der `LT Stack`-Button liess das Frontend aus, obwohl es zum Beobachten laeuft; neuer Task `loadtest:web` (Dev-Modus, :10001), `loadtest:stack down` raeumt den Port mit auf. → [RUNBOOK §3](RUNBOOK.md#3-lasttest-stack-hochfahren-gebauter-stand)

## Phase 4.9: Redis-authoritatives Inventory

Ziel: Redis-Inventar wird nur durch atomare Reserve-/Release-/Finalize-Skripte verändert. Reconcile wird durch Audit, Projektion und sichere Freigabe ersetzt. → ADR-031, [Plan](notes/phases/phase-4-9-inventory-integrity.md)

- [x] **Capacity-Invariante:** die alten Flow-Invarianten waren fuer Ueberzeichnung blind; `available + dbTickets + activeReservations == totalCapacity` ist jetzt eigener Check und macht den reproduzierten `+124`-Zustand zu `system=fail`. → ADR-031
- [x] **Inventory Auditor:** misst Capacity-Delta und Ledger per `GET`/`ZCARD`/`ZCOUNT`; fehlende Keys sind Fehler, niemals Initialisierung oder Korrektur.
- [x] **Sold-count Projector:** Auditor und Projektion teilen genau einen `COUNT(tickets)`-Snapshot je 60-s-Zyklus; Laufzeit/Fehler/letzter Erfolg sind instrumentiert, Redis ist keine Dependency.
- [x] **Reconcile entfernen:** schreibender Kern, Startup-Blocker, Scheduler und `WORKER_RECONCILE_*` sind entfernt; der Subscriber startet unabhaengig vom read-only Inventory-Zyklus.
- [x] **Checkout-State:** Pay claimt per Lua genau einmal `pending → publishing` und markiert nach Publish `paid`; Cancel/Rollback sind auf ihren erwarteten Zustand begrenzt, der oeffentliche Status bleibt bis zur Worker-Finalisierung `pending`.
- [x] **Pending-Reaper:** ZSet-Score ist die exakte Eligibility Deadline; nur faelliges `pending` wird per Lua atomar freigegeben, `publishing|paid` bleiben Recovery-Kandidaten.
- [x] **Inventory-Integrity-Dashboard:** das bestehende Dashboard ist in `Inventory Integrity` umbenannt und zeigt signiertes Capacity-Delta, Final-Invariante, Rohkomponenten, Auditor-Health, Reaper-Aktivitaet und aeltesten Pending-Anspruch.
- [x] **DB-Dashboard:** `db-runtime` zeigt Projector-Query-Dauer, Write-back-Dauer, Health (Fehler, letzter Erfolg) und „Pool Wait during Projector Activity".
- [x] **Abschluss-Lasttest:** erbracht durch den Lauf 2026-08-03 — alle 5 Invarianten, Capacity-Delta 0 nach Drain, keine Projector-Interferenz auf Pool-Wait (ADR-031 beantwortet). → [Beleg](reports/grafana-panels-2026-08-03/PANEL-GUIDE-2026-08-03.md)

## Phase 4.10: Checkout-Expiry-Funnel (entdeckt 2026-08-14)

Reservierungs-Timer im Frontend, 2-min-Deadline und ein Funnel-Lastprofil, das
den Reaper erstmals unter Last ausübt und exakten Sellout beweist.

Details: [Plan](notes/phases/phase-4-10-checkout-expiry.md), Herkunft: [Gedanken-Notiz](notes/backlogs/checkout-expiry-funnel.md)

- [x] **Checkout-Expiry-Funnel planen und schneiden:** Bewertung, Semantik-Entscheidungen (`expired` statt `DEL`, Deadline in `/pay`), Profil-Design und Reihenfolge. → [Gedanken-Notiz](notes/backlogs/checkout-expiry-funnel.md)
- [x] **Vertrag `expiresAt` exponieren:** Deadline zusaetzlich in Pending-Record, Buy-Response und Status-Response, plus Serverzeit gegen Clock-Skew; rein additiv. → [Schnitt 1](notes/phases/phase-4-10-checkout-expiry.md#schnitt)
- [x] **ADR und Ablauf-Semantik:** `expired`-Grabstein statt `DEL`, Deadline-Enforcement im `claimPayment`-Lua, typed Error 410, `payments_rejected_total{reason}`. → ADR-033, [Schnitt 2](notes/phases/phase-4-10-checkout-expiry.md#schnitt)
- [x] **Frontend `/checkout/[orderId]`:** eigene Route mit Countdown und terminalem `expired`-Zustand; loest den 404-Rateschluss in `apps/web/lib/api.ts` ab. → [Schnitt 3](notes/phases/phase-4-10-checkout-expiry.md#schnitt)
- [x] **k6-Profil `funnel`:** vierter `LOAD_PROFILE` mit Profiltabelle statt verstreuter `if`-Zweige, truncated Normal per Box-Muller, neue Counter, `CONFIG_ALLOWLIST`. → [Schnitt 4](notes/phases/phase-4-10-checkout-expiry.md#schnitt)
- [x] **Reaper-Dimensionierung fuer das Profil:** Batch-Groesse und Zyklus gegen die erwartete Ablaufrate rechnen; hier faellt auch σ. → [Schnitt 5](notes/phases/phase-4-10-checkout-expiry.md#schnitt)
- [x] **Lasttest-Stack-Env:** `CHECKOUT_PENDING_TIMEOUT_SECONDS=120` und `SEED_CAPACITY=100000` dort setzen, wo API und Worker starten; Defaults bleiben. → [Schnitt 6](notes/phases/phase-4-10-checkout-expiry.md#schnitt)
- [x] **Abbruchbedingung und Verdict:** Abbruch erst bei `available == 0` **und** leerem Ledger; neue Checks `sold == totalCapacity`, Reaper-Releases > 0, Expired-Rejects > 0. → [Schnitt 7](notes/phases/phase-4-10-checkout-expiry.md#schnitt)
- [x] **Panels ergaenzen:** Expired-Serie im Checkout-Funnel, Abandon-Rate ohne Ablaeufe, plus das bisher nirgends geplottete `reservation_reaper_run_duration_seconds`. → [Schnitt 8](notes/phases/phase-4-10-checkout-expiry.md#schnitt)
- [ ] **Funnel-Lauf fahren:** `HTS_ENV_PROFILE=browse-and-buy-human-pace` (frueher `funnel`, ADR-035), 100k Kapazitaet. Lauf nur mit Freigabe. → [Schnitt 9](notes/phases/phase-4-10-checkout-expiry.md#schnitt)
- [ ] **Optional: 1M mit komprimierter Zeit:** Denkzeit ~6 s, Deadline ~12 s, Reaper-Intervall vom `COUNT`-Zyklus entkoppelt. Erst nach der 100k-Variante. → [Schnitt 10](notes/phases/phase-4-10-checkout-expiry.md#schnitt)
- [x] **Golden-Report-Test reparieren (vorgefunden):** Golden aus dem Renderer regeneriert — ungepolsterte Tabellen sind die gewollte Form. → [Entscheidung](notes/phases/phase-4-10-checkout-expiry.md#vorgefundener-defekt-golden-report-test)

## Phase 4.11: Report-Automation cloud-faehig machen (Vorbedingung fuer den GCP-Lasttest)

- [x] ~~Snapshots, Preflight, Seed-Pfad, verteilter k6-Runner, Monitoring-Quelle.~~ **Aufgeloest 2026-08-18:** die fuenf Todos leben in Phase 5.3, 5.5 und 5.7 weiter. → [Details](notes/backlogs/cloud-report-automation.md#backlog-report-automation-cloud-faehig-vorspann)

## Phase 4.12: Lokale Baseline C mit getrenntem Lastgenerator (Zwei-Maschinen-Setup)

Ersetzt das verworfene Phase-4.4-Todo auf lokalem Massstab: k6 auf dem Ryzen-PC, SUT allein auf dem MacBook, Ziel 5k RPS sustained (REQ-P01). → [Details](notes/backlogs/local-generator-split.md#backlog-lokaler-generator-sut-split-vorspann)

- [x] **SUT-Host (MacBook) vorbereiten:** API/Metrics auf LAN-IP binden, Fremdcontainer fuer den Lauf stoppen, Setup dokumentieren. → [RUNBOOK §3](RUNBOOK.md#zwei-maschinen-setup-generator-getrennt-vom-sut), Task `loadtest:stack up` (Topologie-Abfrage)
- [x] **Generator-Host (Ryzen-PC) anbinden:** ssh-Spawn als Hauptpfad, manueller Lauf nur Fallback; Ethernet, WLAN nur Fallback. → [RUNBOOK §3](RUNBOOK.md#generator-host-einrichten-windows-pc), [§4 Split-Kommando](RUNBOOK.md#zwei-maschinen-lauf-k6-auf-dem-generator-pc)
- [x] **Baseline C mit getrenntem Generator fahren:** Gefahren 2026-08-17: `degraded` (3,10 % dropped), `system pass`, echter Sellout, ~8k Iterationen/s sustained (REQ-P01 mit Vorbehalt uebertroffen). → [Report](reports/baseline-c-split-2026-08-17/LOAD-TEST-REPORT-2026-08-17.md)
- [x] **Transportfehler nach Endpunkt aufschluesseln:** Threshold-Sub-Metriken (`count>=0`) in beiden Phasen-Skripten, Aufschluesselung in Report §4; bewusst endpoint-only, kein `error_code`-Kreuzprodukt.
- [ ] **Transportfehler auf dem Buy-Bein untersuchen:** bleiben auch mit getrenntem Generator (Phase A: buy 94 598, availability 18 872); Host-Contention-Hypothese widerlegt. → [Befund](reports/baseline-c-split-2026-08-17/LOAD-TEST-REPORT-2026-08-17.md)
- [ ] **Valid-Baseline nachziehen:** 3,10 % dropped liegt ueber der Warnschwelle; Zielrate senken oder Generator-VU-Budget erhoehen und erneut fahren. Lauf nur mit Freigabe.
- [x] **Lastprofile konsolidieren und nach Szenario benennen:** 4 → 3 Profile (`browse-and-buy-full-speed` als Default mit Sellout-Semantik, `browse-and-buy-human-pace`, `buy-only-full-speed`); `realism` entfaellt, Gates haengen an Semantik statt Namen. → ADR-035
- [x] **Generator-Kardinalitaet begrenzen:** die orderId im k6-`name`/`url`-Tag erzeugte eine Zeitreihe pro Bestellung (3,2 Mio nach ~3,5 min). Statischer `name`-Tag plus `SYSTEM_TAGS` ohne `url`.

## Phase 5: Cloud Deployment (GCP)

Roter Faden: erst lokal beweisen (5.1–5.3), dann Cloud (5.4–5.7); Cloud-Arbeit
erst nach gemeinsamer GCP-Einarbeitung. Anforderungen: REQ-D01–D06. → [Details](notes/phases/phase-5-cloud-deployment.md)

### Phase 5.1 — Containerisierung und lokales Kubernetes

- [ ] **Dockerfiles fuer API, Worker, Web:** Runtime-Pfad `dist`, Build in GitHub Actions. → ADR-019, ADR-007
- [ ] **Manifeste gegen lokalen Cluster, 1 Replica:** Datenstores bleiben Compose. Entscheidung: lokaler Cluster als Vorstufe → ADR-010-Nachtrag; `k8s/` in DOCS.md routen.

### Phase 5.2 — Multi-Replica-Korrektheit lokal

- [ ] **N API-Replicas hinter Ingress:** Korrektheit statt Kapazitaet (REQ-D02).
- [ ] **Entscheidung Zeitquellen bei Replicas:** Sale-Unlock (ADR-024) und Checkout-Deadline (ADR-033) gemeinsam entscheiden; Drift-Nachweis erst in 5.6.
- [ ] **Entscheidung Instanzzahl je Komponente** (REQ-D02; Worker: ADR-004/ADR-031); Graceful Shutdown aus Phase 6 als Vorbedingung fuer Rolling Updates.

### Phase 5.3 — Messkette umgebungsunabhaengig

- [ ] **Zugriffspfade abstrahieren** (Snapshots, Preflight, Reset/Seed, TSDB-Wipe, Sold-out-Quelle ADR-025); eigener ADR.
- [ ] **Aggregation bei N Instanzen fixen:** `targetUp`/Erst-Serie-Queries, `sum()` ueber replizierte Gauges (REQ-D04).

### Phase 5.4 — Cloud-Fundament

- [ ] **IaC fuer Netz, DB, Cache, Cluster, Queue, Registry, Secrets;** Manifeste via Kubeconfig. → Entscheidungsmatrix in der Details-Notiz (ADR-003/005/010/031/034)
- [ ] **Smoke:** ein E2E-Kauf in der Cloud, danach vollstaendiger Abbau (REQ-D01).

### Phase 5.5 — Cloud-Monitoring

- [ ] **Entscheidung Monitoring-Quelle:** neuer ADR; ADR-006 bleibt fuer lokal gueltig (Nachtrag). Grafana + Renderer gehoeren zur Evidenz (ADR-030, REQ-O04).

### Phase 5.6 — Cloud-Baseline auf Paritaetsniveau

- [ ] **`spike:report` in der Cloud mit dem Referenzprofil** (REQ-P01), Vergleich gegen die lokale Referenz-Baseline (REQ-D03, REQ-D05 Stufe 1). Lauf nur mit Freigabe.

### Phase 5.7 — Cloud-Zielprofil

- [ ] **Verteilter Generator** inkl. Quantil-Merge der Teil-Summaries; Kapazitaet fuer den 50k-Lauf entscheiden (REQ-P02). Haengt an den offenen 4.12-Todos. Lauf nur mit Freigabe.

## Phase 6: Optional & Resilience (Maximum Learning)

Details: [baseline-b-storage-review](notes/backlogs/baseline-b-storage-review.md)

- [ ] Fuehre danach ein Storage-Review fuer den Order-Flow durch: Redis-/DB-Footprint pro Order messen, TTL-/Key-Strategie bewerten, Optimierungen priorisieren. → [Datenbasis aus Baseline B](notes/backlogs/baseline-b-storage-review.md#datenbasis-aus-baseline-b-fuer-das-storage-review)
- [ ] Implementiere Dead Letter Queue (DLQ) in Pub/Sub und einen Retry/Replay-Mechanismus im Worker.
- [ ] Implementiere Idempotency Keys für die Ticket-Kauf-Route (API & DB) um doppelte Käufe zu verhindern.
- [ ] Füge Rate Limiting in Fastify (via Redis) als Bot-Protection hinzu.
- [ ] Integriere den k6 Lasttest als Quality Gate in GitHub Actions (Fail bei großer Latenz oder hohen Error-Rates).
- [ ] Simuliere Chaos Engineering (z.B. Redis oder Worker Ausfälle während des Lasttests) um zu testen, ob das System graceful degradiert.
- [ ] Definiere Polling-Strategie fuer Order-Status (Backoff + Jitter, optional Long-Polling) zur Load-Reduktion.
- [ ] Konfiguriere `maxDeliveryAttempts` + Dead-Letter Topic pro Subscription, um Retry-Stuerme zu begrenzen.
- [ ] Definiere klare Poison-Message-Policy (ACK+DLQ vs. NACK) fuer invalides JSON, Schema-Fehler und unbekannte Event-Versionen.
- [ ] Implementiere Worker-Graceful-Shutdown mit Drain-Verhalten (in-flight Messages abschliessen; Processing-Locks existieren seit dem ADR-004-Update 2026-07-14 nicht mehr).
- [ ] Erstelle Replay-Tooling fuer DLQ-Nachrichten (selektiver Replay nach Fehlerklasse, Dry-Run-Modus).
- [ ] Definiere SLOs + Alerting fuer Resilience-Signale (NACK-Rate, Redelivery-Rate, DLQ-Groesse, stuck pending orders).
- [ ] Dokumentiere Incident-Runbook fuer Queue-Backlog, Redis-Ausfall und DB-Partial-Outage (Detection, Mitigation, Recovery).
- [ ] Schließe die letzte Ausnahme in `apps/web` (`check-types`) auf `tsgo`, sobald Side-Effect-CSS-Imports (`./globals.css`) im Native-Preview kompatibel sind.
- [ ] Migriere Dev-Watch-Restart-Flow von `tsc-watch` auf einen `tsgo`-basierten Restart-Workflow (API + Worker).
