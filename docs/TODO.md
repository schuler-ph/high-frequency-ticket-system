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
- [x] Führe lokalen Lasttest gegen Docker-Setup aus und dokumentiere erste Bottlenecks (`docs/LOAD-TEST-REPORT-2026-07-14.md`; Baseline A: 11,7k Peak-RPS, 68,24 % dropped iterations, 420.951 accepted = completed nach Drain, ~406 s mittlere E2E-Latenz).
- [ ] Trenne den Lastgenerator vom System-under-Test bzw. nutze einen verteilten Runner; dimensioniere fuer das 50k-RPS-Ziel mindestens ~20k aktive VUs und fordere 0 dropped iterations fuer einen gueltigen Kapazitaetsnachweis.
- [ ] Ergaenze k6-Metriken nach Endpoint, HTTP-Status und Transportfehlerklasse, damit die 0,28 % Requests ohne App-Response diagnostizierbar sind.
- [x] Sale-Unlock-Gate: `tickets:event:{eventId}:opensAt`-Redis-Key im atomaren Reserve-Script, `TooEarlyError` (HTTP 425), `SALE_OPENS_IN_SECONDS` im Seed-Skript (ADR-024) — Reaktion auf Baseline A, in der der Verkauf ab `t=0` offen war statt einen echten Sale-Start abzubilden.
- [ ] Sale-Unlock-Gate: das atomare Reserve-Lua-Script gegen echtes Redis testen (fehlender `opensAt`-Key, `opensAt=0`, `nowMs` vor/nach dem Schwellwert) — der bestehende Unit-Test mockt nur den `-2`-Rueckgabewert, die Script-Branches selbst laufen nirgends (ADR-024-Follow-up).
- [ ] Buy-Route: `409` (Sold-Out) und `425` (Too Early) zusaetzlich im OpenAPI-Response-Schema deklarieren (aktuell nur `202`; die Fehler kommen bislang nur ueber den globalen Error-Handler) — niedrige Prioritaet (ADR-024-Follow-up).
- [x] Restrukturiere den lokalen Lasttest auf reaktive Sold-Out-Erkennung statt fixer Phasen-Timer: `spike-phase-a.js` (Warm-Up/Ramp-Up/Sustain) + `spike-phase-b.js` (Cool-Down), orchestriert durch `scripts/local/run-spike.mjs` (pollt Availability, stoppt Phase A per SIGINT bei bestaetigtem Sold-Out) (ADR-025) — behebt, dass Baseline A mitten im Peak statt am beabsichtigten Sold-Out-Uebergang endete.
- [x] Dokumentiere die automatisierbare Evidence-/Report-Pipeline inkl. verwendeter Prometheus-, PostgreSQL- und Redis-Abfragen, Validitaetsregeln, Artefaktvertrag und schrittweisem Implementierungsplan (`docs/LOAD-TEST-REPORT-AUTOMATION.md`).
- [ ] Implementiere das MVP aus `docs/LOAD-TEST-REPORT-AUTOMATION.md`: Run-Manifest, k6-JSON-Summaries, Before/After-Counter, Drain-Monitor, Histogram-Saturation, DB-/Redis-Snapshots, Invarianten und deterministischer Markdown-Report.
- [ ] Fuehre den restrukturierten Lasttest (`pnpm spike`) als neue Baseline aus und vergleiche gegen `docs/LOAD-TEST-REPORT-2026-07-14.md` (insbesondere Worker-Drain-Rate ~481/s als Engpass fuer den Sold-Out-Zeitpunkt).
- [ ] **Reihenfolge-Abhaengigkeit vor obigem Baseline-Lauf:** ~~Zuerst #5 (Reservation-Ledger) landen~~ ✅ #5 ist umgesetzt (ADR-026): der TTL-getriebene Oversell-Pfad existiert nicht mehr, Reconcile bucht bei langer Queue-Latenz kein Inventar mehr zurueck. Verbleibende Vorbedingung: die P1-Dashboard-Fixes (Zero-Serien, E2E-Buckets) vorziehen, damit der Lauf nicht erneut blind fuer sein wichtigstes Symptom ist. Optional beobachten: `reservation_ledger_stale` (Phantom-Claims ohne Reaper, Phase 6) und Drift sollten waehrend des Laufs ~0 bleiben.

## Phase 4.5: Monitoring & Observability

- [x] Integriere `prom-client` in `apps/api` und Worker für Custom-Metriken (Counter, Histogram).
- [x] Exponiere `/metrics` Endpunkt für Prometheus-Scraping (API & Worker).
- [x] Messe E2E-Latenz von `POST /buy` bis `order completed|failed` als Prometheus-Histogram (`order_e2e_latency_seconds`, Labels: `event_id`, `status`).
- [x] Füge Grafana + Prometheus Services zur `docker-compose.yml` hinzu.
- [x] Konfiguriere Prometheus Target Scraping (für API & Worker Container).
- [x] Erstelle Grafana-Dashboard: API Performance (Latenz, RPS, Error-Rate).
- [x] Erstelle Grafana-Dashboard: Order Lifecycle (`accepted`, `pending`, `completed`, `failed`, Completion-Rate).
- [x] Erstelle Grafana-Dashboard: Order Completion Latency (`buy accepted` → `completed|failed`, p50/p95/p99).
- [x] Erstelle Grafana-Dashboard: Redis Performance (Hit/Miss Ratio) — Placeholder, benötigt `redis_exporter` in docker-compose + Prometheus.
- [x] Erstelle Grafana-Dashboard: Pub/Sub Queue Depth & Worker Processing Rate — Worker-Proxy-Panels implementiert; vollständige Queue-Tiefe erfordert Stackdriver-Exporter (GCP) oder pubsub_exporter.
- [x] Erstelle Grafana-Dashboard: Worker Reliability (Redeliveries, Idempotenz-Hits, Processing-Lock-Konflikte, Kompensationen).
- [x] Erstelle Grafana-Dashboard: Reservation & Consistency (aktive Reservations, Publish-Rollbacks, Redis-DB-Drift).
- [x] Konfiguriere k6 Output zur Speicherung in Prometheus/Grafana für Live-Views (`pnpm spike` nutzt `experimental-prometheus-rw`).
- [ ] Korrigiere Dashboard-PromQL fuer fehlende Zero-Serien (`or vector(0)`), damit Pending/Queue/Error/Failure/Reliability bei null Fehlern nicht als `No data` verschwinden.
- [ ] Erweitere `order_e2e_latency_seconds` ueber den 30-s-Bucket hinaus und benenne die rollende Completion-Rate als Throughput-Verhaeltnis; entferne die irrefuehrende Legendensumme der kumulativen Counts.
- [ ] Fuege `redis_exporter` sowie CPU/Event-Loop-, PostgreSQL-Pool-Wait-, Query-Latency- und Lock-Wait-Metriken fuer belastbare Bottleneck-Zuordnung hinzu.
- [ ] Erzeuge Screenshots der Dashboards unter extremer Last für die README.

## Phase 4.6: Standard-Flow-Optimierung (vgl. `docs/ANALYSIS-STANDARD-FLOW.md`)

Risikoarme Massnahmen (Analyse §9, Nr. 1/2/6/8/10) und der Handler-Block (Nr. 3/4) — umgesetzt:

- [x] #10: Redis-Typ-Schatten/Casts durch zentrales `@repo/types/redis-client` ersetzen; Zod-Parse selbst konstruierter Literale durch `satisfies` (Zod bleibt an allen externen Grenzen).
- [x] #1: Reserve+Reservation+Pending-Order als **ein** atomares Lua-Script via ioredis `defineCommand`/EVALSHA; Publish-Rollback als idempotentes Gegen-Script (3→1 RTT, ADR-005-Update).
- [x] #2: Worker Idempotenz-Check+Lock als ein Script (`beginOrderProcessing`), Finalisierung (Order-Cache + `processed`-Marker + Lock-Release) als ein Script (5→2 RTT pro Message, ACK/NACK-Semantik unveraendert).
- [x] #6: Reconcile korrigiert `available` als Delta (`INCRBY`) statt absolutem `MSET` (schliesst das Lost-Decrement-Fenster); `redis_db_drift_tickets`-Gauge (ADR-023) verdrahtet.
- [x] #8: `PUBSUB_FLOW_CONTROL_MAX_MESSAGES` (Default 500) und `DATABASE_POOL_MAX` (Default 20) als explizite, aufeinander abgestimmte Env-Knobs (siehe ARCHITECTURE.md "Worker-Durchsatz & Backpressure").
- [x] #3: Handler liefert `BuyTicketOutcome`-Wert; ACK/NACK + Metriken als Policy-Tabelle (`buyTicketOutcomePolicy`) im Listener — die Doku-Tabelle ist woertlich Code, ack/nack genau einmal pro Nachricht.
- [x] #4: `processing`-Lock gestrichen — Idempotenz traegt die `buy_ticket`-DB-Transaktion (ON CONFLICT); `processed`-Marker bleibt als Redelivery-Shortcut (ADR-004-Update, Key-Lifecycle-/ACK-NACK-Tabelle, Worker-Reliability-Dashboard).

Offene Folge-Massnahmen (Analyse §9, vor dem naechsten grossen Lasttest):

- [x] Lokalen Lasttest als Baseline ausfuehren und Vorher-Zahlen fuer #5/#7 dokumentieren (`docs/LOAD-TEST-REPORT-2026-07-14.md`).
- [x] #5 (durch Baseline A praezisiert): Accepted-but-not-finalized Reservations als ZSet/Ledger (`tickets:event:{eventId}:reservations`, Score = Erstellungszeit, kein TTL) statt Keyspace-SCAN; Entfernung nur durch Worker-Finalisierung (`ZREM` im Finalize-Script) / Kompensation. Reconcile zaehlt via `ZCARD` (O(1)) statt SCAN; Ablauf ist nur ein Stale-Kandidat (`ZCOUNT` → `reservation_ledger_stale`-Gauge, Schwellwert `RESERVATION_STALE_SECONDS`) fuer den Reaper (Phase 6), **keine** automatische Rueckbuchung. Behebt das Baseline-A-Oversell-Risiko (temporaer -314k Drift bei 120-s-TTL vs. ~406-s-E2E). Neuer ADR-026, ADR-022/023-Status aktualisiert; Lua gegen `hts-redis` verifiziert. Regressionstest: Reconcile bucht bei alten/stale Reservierungen kein Inventar zurueck.
- [ ] #7: `buy_ticket` ohne `sold_count`-Hot-Row-UPDATE (Aggregation im Reconcile); Order direkt als `completed` einfuegen (ADR-011-Update, Migration + `db:push`, Guardrail-Script `check-buy-ticket-contract.mjs`).
- [ ] #7 vor Umsetzung isoliert benchmarken: Payment-Mock parameterisieren/deaktivieren, Flow-Control >1.000 setzen und DB-Pool-Wait/Query-/Lock-Wait messen; Baseline A erreichte bereits den erwarteten 500/s-Flow-Control-Deckel und beweist den Hot-Row-Limiter daher noch nicht separat.
- [ ] #9: Topic/Subscription-Provisioning (Emulator-Bootstrapping) nach `scripts/local/` verschieben; `*Like`-Typen und Zweiphasen-Start entfernen.

## Phase 4.7: Checkout & Payment-Simulation (Web + API)

Ziel: Der Kauf laeuft nicht mehr als ein einziger `POST /buy`-Klick, sondern als realistischer Checkout — Reservierung beim "Kaufen", ein Payment-Modal mit simuliertem 3DS, und danach ein Live-Order-Status auf derselben Seite. Leitentscheidung (siehe neuen ADR-027): **`POST /buy` reserviert nur, die neue synchrone Pay-Route published** — das Ticket ist waehrend der Zahlung gehalten, der Worker sieht die Order erst nach bestaetigter Zahlung.

### Backend: Reserve/Pay-Split (`apps/api` + `packages/types`)

- [ ] **Buy entkoppeln:** `POST /api/tickets/:eventId/buy` reserviert nur noch (Lua: `DECR available` + Ledger-`ZADD` + `pending`-Order) und liefert `orderId` + `202`, **ohne** Pub/Sub-Publish. Der bisherige Publish-Rollback-Pfad entfaellt an dieser Stelle (kein Publish mehr im Buy). Bestehende Buy-Route-Tests entsprechend anpassen.
- [ ] **Payment-DTO in `packages/types`:** Zod-Schema fuer den (simulierten) Payment-Request (`cardHolder`, `cardNumber`, `expiry`, `cvc`) + Response (`confirmed`, `orderId`). Keine echten Kartendaten — reine Simulation; im Schema klar als Fake/Dummy kennzeichnen und keine Persistenz der Zahlungsdaten.
- [ ] **Synchrone Pay-Route:** `POST /api/orders/:orderId/pay` — validiert das Payment-DTO, simuliert die 3DS-Challenge (kurzer Sleep/Erfolgs-Stub), **published** dann `BuyTicketEvent` an Pub/Sub und antwortet synchron (`200`, sobald der Publish bestaetigt ist). Wichtig: Async-Writes-Regel bleibt gewahrt — die Route schreibt niemals in PostgreSQL, sie published nur; die Persistenz traegt weiterhin der Worker. `queuedAt` wird beim Publish (Pay-Zeitpunkt) gesetzt, damit die E2E-Latenz die Zahlungszeit nicht mitmisst.
- [ ] **Publish-Rollback im Pay-Pfad:** Schlaegt der Publish in der Pay-Route fehl, Reservation via bestehendem Gegen-Script freigeben (`ZREM` + `INCR available` + Pending-`DEL`) und Fehler zurueckliefern (analog zum alten Buy-Rollback).
- [ ] **Checkout-Abbruch/Timeout behandeln:** Bricht der Nutzer das Modal ab oder scheitert 3DS, bleibt die Ledger-Reservierung sonst als Phantom-Anspruch stehen (ZSet ohne TTL, ADR-026). Explizite Release-Route (`POST /api/orders/:orderId/cancel`, ruft `releaseTicketReservation`) fuer Modal-Close/Timeout ergaenzen; das Aufraeumen wirklich verwaister Reservierungen bleibt beim Reaper (Phase 6). Metrik fuer abgebrochene Checkouts ergaenzen.
- [ ] **Tests:** Pay-Route (Happy Path publish + `200`, Publish-Fehler → Rollback), Cancel-Route (Release + idempotent), sowie Anpassung des End-to-End-Flow-Tests auf `buy` (reserve) → `pay` (publish) → Worker → `GET /api/orders/:orderId`.
- [ ] **ADR-027 + Doku-Lockstep:** Neuen ADR-027 (Reserve→Pay→Publish-Split, Interaktion mit Async-Writes-Regel und Reservation-Ledger) anlegen; `ARCHITECTURE.md` Happy-Path-Schritte 3–5, das Flow-Diagramm und den Redis-Key-Lifecycle (Ledger-Lebensdauer bei abgebrochenem Checkout) aktualisieren.

### Frontend: Checkout-Flow (`apps/web`)

- [ ] **Auto-Fill Namen:** Vor-/Nachname-Inputs beim Betreten der `open`-Phase mit zufaelligen Namen vorbefuellen (kleiner clientseitiger Name-Generator, keine externe Dependency); weiterhin editierbar.
- [ ] **Payment-Modal:** Nach "Ticket kaufen" zuerst `POST /buy` (Reservierung), dann Tailwind-Modal oeffnen mit vorbefuellten Fake-Zahlungsdaten (Karteninhaber, Kartennummer, Ablaufdatum, CVC). Kein CSS ausserhalb von Tailwind.
- [ ] **Fake-3DS-Challenge:** Nach "Bezahlen" einen simulierten 3DS-Schritt anzeigen (z. B. Spinner/OTP-Prompt), der `POST /api/orders/:orderId/pay` aufruft; Erfolg/Fehler sauber im Modal behandeln.
- [ ] **Modal-Abbruch:** Beim Schliessen/Abbrechen des Modals `POST /api/orders/:orderId/cancel` aufrufen, damit die Reservierung freigegeben wird.
- [ ] **Neue `tracking`-Phase:** Nach erfolgreicher Zahlung auf eine neue Inline-Phase der Single-Page umschalten (bestehendes `Phase`-Modell `loading|upcoming|open|soldout` um `tracking` erweitern), die den Order-Status anzeigt.
- [ ] **Live-Order-Status:** In der `tracking`-Phase `GET /api/orders/:orderId` pollen (Backoff/Jitter aus Phase 6 optional beruecksichtigen) und `pending → completed|failed` inkl. Ticket-Referenz live darstellen; Fehl-/Failed-Status verstaendlich anzeigen.

## Phase 5: Cloud Deployment (GCP)

- [ ] Erstelle Terraform-Skripte für VPC, Cloud SQL, Memorystore und GKE.
- [ ] Erstelle Dockerfiles für API, Worker und Web.
- [ ] Schreibe Kubernetes Deployment/Service/Ingress Manifeste.
- [ ] Führe Cloud-Lasttest aus und sammle Metriken für die README.
- [ ] **Sale-Unlock-Zeitquelle bei `API replicas > 1` (ADR-024):** Der `opensAt`-Gate-Check vergleicht aktuell gegen `nowMs`, das die API aus `Date.now()` uebergibt — nicht gegen `redis.call("TIME")` im Lua-Script. Das haelt das Script unabhaengig von Redis' Lua-Replikationsverhalten und erlaubt, denselben Zeitstempel als `queuedAt` im Pub/Sub-Payload wiederzuverwenden (ein `Date.now()` pro Request statt zwei). Trade-off: Der Verkaufsstart oeffnet nur so praezise, wie die Uhren der API-Pods synchron sind; bei Uhr-Drift faellt der Unlock pro Pod um die Drift-Spanne unterschiedlich. Lokal (ein Prozess) irrelevant, in GKE deckt NTP-Sync die geforderte Sekunden-Genauigkeit. **Extension:** Falls sub-sekunden-exakter, prozessuebergreifend identischer Unlock gefordert wird, auf `redis.call("TIME")` (eine autoritative Uhr) umstellen — dann entfaellt die `queuedAt`-Wiederverwendung und es faellt ein zweiter Zeitstempel-Roundtrip an; ADR-024 entsprechend aktualisieren.

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
- [ ] Ergänze Reaper-Job fuer stale `pending` Orders und stale Ledger-Reservationen inkl. sicherer Kompensation. Datenbasis liegt seit ADR-026 vor: `ZRANGEBYSCORE tickets:event:{eventId}:reservations 0 (now − RESERVATION_STALE_SECONDS·1000)` liefert die Kandidaten deterministisch, die `reservation_ledger_stale`-Gauge macht den Bestand sichtbar. Rueckgewinnung nur nach Order-/Queue-Recovery (DLQ), nicht allein wegen Alter.
- [ ] Erstelle Replay-Tooling fuer DLQ-Nachrichten (selektiver Replay nach Fehlerklasse, Dry-Run-Modus).
- [ ] Definiere SLOs + Alerting fuer Resilience-Signale (NACK-Rate, Redelivery-Rate, DLQ-Groesse, stuck pending orders).
- [ ] Dokumentiere Incident-Runbook fuer Queue-Backlog, Redis-Ausfall und DB-Partial-Outage (Detection, Mitigation, Recovery).
- [ ] Schließe die letzte Ausnahme in `apps/web` (`check-types`) auf `tsgo`, sobald Side-Effect-CSS-Imports (`./globals.css`) im Native-Preview kompatibel sind.
- [ ] Migriere Dev-Watch-Restart-Flow von `tsc-watch` auf einen `tsgo`-basierten Restart-Workflow (API + Worker).
