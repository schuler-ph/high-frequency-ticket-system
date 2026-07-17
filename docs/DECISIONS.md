# Architecture Decision Records (ADR)

Jede Architekturentscheidung wird hier als ADR dokumentiert. Das erlaubt es, den Kontext und die Begründung jeder Entscheidung nachzuvollziehen – sowohl für Teammitglieder als auch für KI-Agenten, die am Projekt arbeiten.

## ADR Status & TODO-Mapping

Dieses Kapitel verknüpft jede ADR mit dem aktuellen Umsetzungsstatus und der Stelle in `docs/TODO.md`, in der die Umsetzung erledigt wurde oder geplant ist.

| ADR                                                        | Status           | TODO-Abbildung                                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 Monorepo mit Turborepo                             | Fertig           | Phase 1 (Foundation & Tooling) erledigt                                                                                                                                                   |
| ADR-002 Fastify statt Express                              | Fertig           | Phase 3 (Core Logic) API + Worker Setup erledigt                                                                                                                                          |
| ADR-003 Drizzle ORM statt Prisma                           | Fertig           | Phase 2 (Data Layer) Drizzle Setup + Migration erledigt                                                                                                                                   |
| ADR-004 Asynchrone Writes über Pub/Sub                     | Fertig           | Phase 3 Buy-Flow + Phase 3.5 ACK/NACK + Idempotenz + Kompensation vollständig erledigt                                                                                                    |
| ADR-005 Redis als Read-Cache                               | Fertig           | Phase 3.5 event-spezifische Keys, Reservation-Flow, Atomic Lua, Reconcile vollständig erledigt                                                                                            |
| ADR-006 Prometheus + Grafana                               | Teilweise fertig | prom-client + /metrics-Endpunkte (API + Worker) erledigt; Grafana-Dashboards noch offen (Phase 4.5)                                                                                       |
| ADR-007 GitHub Actions für CI/CD                           | Fertig           | Phase 1 (`.github/workflows/ci.yml`) erledigt                                                                                                                                             |
| ADR-008 Zod für Validation & DTOs                          | Fertig           | Phase 2 DTOs + Phase 3 Route-Schemas erledigt; DTO-Vertrag für Tests dokumentiert                                                                                                         |
| ADR-009 Husky für Git Hooks                                | Fertig           | Bereits umgesetzt (außerhalb der Phasenliste, als Standard-Tooling aktiv)                                                                                                                 |
| ADR-010 Terraform für IaC                                  | Geplant          | Phase 5 (Cloud Deployment)                                                                                                                                                                |
| ADR-011 Capacity Model vs. Pre-generated Tickets           | Fertig           | Phase 2/3/3.5 vollständig umgesetzt: capacity-basiert, on-the-fly INSERT, sold_count via SQL-Function                                                                                     |
| ADR-012 Guest Checkout                                     | Fertig           | Phase 3 Buy-Request ohne Auth umgesetzt                                                                                                                                                   |
| ADR-013 Payment Flow Mocking                               | Fertig           | Worker sleep(1000ms) aktiv umgesetzt (Phase 3 + 3.5)                                                                                                                                      |
| ADR-014 Cloud Provider GCP                                 | Geplant          | Phase 5 (GCP Terraform + Deployment)                                                                                                                                                      |
| ADR-015 Custom Error Classes & Secure Error Handling       | Fertig           | Phase 3 Error Handler und typed errors umgesetzt                                                                                                                                          |
| ADR-016 GCP-ready Structured Logging mit Pino              | Fertig           | API/Worker Logger-Konfiguration umgesetzt                                                                                                                                                 |
| ADR-017 Order-Status via Polling                           | Fertig           | Phase 3.5 Orders↔Tickets vollständig verknüpft; GET /api/orders/:orderId mit Redis-Read-Model fertig                                                                                      |
| ADR-018 Ticket-Kauf via SQL-Function im Worker             | Fertig           | Phase 3 Worker nutzt `buy_ticket(...)`                                                                                                                                                    |
| ADR-019 TypeScript CLI via tsgo                            | Teilweise fertig | Phase 1 Tooling: `tsc` in Build/Test/Typecheck weitgehend migriert; Ausnahmen Web-Checktypes + Dev-Watch folgen                                                                           |
| ADR-020 Deterministische Tests & Debug-Guardrails          | Fertig           | Phase 1 Tooling: feste Test-Entrypoints, Debug-Skripte, Runbook und CI-Guardrails umgesetzt                                                                                               |
| ADR-021 Direkte Backend-Tests via node:test + native TS    | Fertig           | Phase 1 Tooling: API/Worker/DB Tests laufen paketlokal ohne Shared Runner, Vitest oder tsx im Test-Hot-Path                                                                               |
| ADR-022 Periodischer Reconcile-Loop (Singleton-Deployment) | Fertig           | Phase 3.5: zyklischer Reconcile mit self-scheduling setTimeout, Betriebsmodi via Env-Vars, sauber via Fastify onClose stoppbar; zaehlt Reservierungen seit ADR-026 via `ZCARD` statt SCAN |
| ADR-023 E2E-Observability (queuedAt + Drift-Metrik)        | Fertig           | Phase 3.5: queuedAt-Timestamp im Payload, order_e2e_latency_seconds Histogram, redis_db_drift_tickets Gauge; `active_reservations` = `ZCARD` seit ADR-026                                 |
| ADR-024 Sale-Unlock-Gate (425 Too Early)                   | Fertig           | Phase 4: `opensAt`-Redis-Key im atomaren Reserve-Script, TooEarlyError, Seed-Skript-Unterstuetzung                                                                                        |
| ADR-025 Reaktive Sold-Out-Orchestrierung im Lasttest       | Fertig           | Phase 4: k6 Phase-A/B-Split + Node-Orchestrator (`scripts/local/run-spike.mjs`)                                                                                                           |
| ADR-026 Redis-Exporter + DB-/Runtime-Bottleneck-Metriken   | Fertig           | Phase 4.5: `redis_exporter`-Container, Worker-DB-Pool-/Query-/Lock-Metriken, Dashboard „DB & Runtime“                                                                                     |
| ADR-027 Reservation-Ledger (ZSet) statt Keyspace-SCAN      | Fertig           | Phase 4.6 (#5): akzeptierte Reservierungen im TTL-losen ZSet-Ledger, Reconcile via `ZCARD`/`ZCOUNT`, Ablauf = Stale-Kandidat statt Rueckbuchung (behebt Baseline-A-Oversell)              |

### Status-Definitionen

- **Fertig:** Architekturentscheidung ist im Codepfad aktiv und im Alltag genutzt.
- **Teilweise fertig:** Kern ist umgesetzt, aber Resilience/Konsistenz/Skalierungsdetails fehlen noch.
- **Geplant:** Entscheidung ist dokumentiert, Umsetzung liegt in einer offenen TODO-Phase.

---

## ADR-001: Monorepo mit Turborepo

- **Datum:** 2026-02-24
- **Kontext:** Einzelnes Showcase-Projekt mit Frontend, API, Worker und shared Packages. Recruiter und Reviewer sollen alles in einem Repository sehen können.
- **Entscheidung:** Turborepo mit pnpm Workspaces.
- **Begründung:** Einfacher als Nx für diesen Scope. Exzellentes Build-Caching. Nativer Support für pnpm. Klare Workspace-Struktur (`apps/*`, `packages/*`).
- **Alternativen:** Nx (zu komplex für Scope), separate Repositories (fragmentiert Portfolio).

---

## ADR-002: Fastify statt Express

- **Datum:** 2026-02-24
- **Kontext:** High-Concurrency API benötigt maximale Performance bei I/O-bound Workloads. Das System muss unter extremer Last (50.000+ gleichzeitige Nutzer) stabil bleiben.
- **Entscheidung:** Fastify als HTTP-Framework für API Gateway und Worker.
- **Begründung:** ~2x schneller als Express in Benchmarks. Schema-basierte Serialisierung reduziert Overhead. Native TypeScript-Unterstützung. Plugin-Architektur passt zu Microservice-Pattern.
- **Alternativen:** Express (langsamer, legacy patterns), Hono (weniger Ecosystem-Support für Node.js).

---

## ADR-003: Drizzle ORM statt Prisma

- **Datum:** 2026-02-24
- **Kontext:** ORM muss typsicher sein, nah an SQL bleiben und minimalen Runtime-Overhead erzeugen. Späterer Wechsel zu Cloud Spanner muss möglich sein.
- **Entscheidung:** Drizzle ORM (Code-First).
- **Begründung:** Typen werden direkt aus dem Schema inferiert (`$inferSelect`, `$inferInsert`). Kein Code-Generator nötig. SQL-nah = einfacherer Wechsel zu Cloud Spanner. Leichtgewichtiger als Prisma (kein Rust-basierter Engine-Binary).
- **Alternativen:** Prisma (schwerer, generierter Client), Kysely (kein Migration-Tooling).

---

## ADR-004: Asynchrone Writes über Pub/Sub

- **Datum:** 2026-02-24
- **Kontext:** Bei Lastspitzen (Ticket-Sale-Start) würden direkte DB-Schreibzugriffe die PostgreSQL-Instanz überlasten. Die API muss sofort antworten können, unabhängig von der DB-Kapazität.
- **Entscheidung:** API published Kauf-Intents in Google Cloud Pub/Sub, Worker konsumiert und schreibt in DB.
- **Begründung:** Entkopplung von Spike-Traffic und DB-Write-Kapazität. API kann sofort HTTP 202 (Accepted) antworten. Pub/Sub garantiert At-Least-Once Delivery. Worker kann unabhängig skaliert werden.
- **Alternativen:** Direktes DB-Write mit Connection Pooling (skaliert nicht ausreichend), Redis Streams (weniger Feature-reich als Pub/Sub).

### Update 2026-03-13: ACK/NACK-Regeln im Worker

- **Kontext:** Für At-Least-Once Delivery muss klar definiert sein, wann der Worker ACK (terminal) und wann NACK (retrybar) sendet.
- **Entscheidung:**
  - ACK bei erfolgreicher Verarbeitung.
  - ACK bei terminalem Business-Fehler `P0001` (Event nicht gefunden).
  - NACK bei technischen/transienten Fehlern (z.B. DB-Write-Fehler).
  - NACK bei nicht parsebarem JSON und aktuell auch bei Schema-Validation-Fehlern.
- **Begründung:** Retries sollen nur dort stattfinden, wo sie potenziell erfolgreich sein können. Deterministische Business-Fehler werden nicht erneut zugestellt.
- **Umsetzung:**
  - `apps/worker/src/routes/pubsub-listener.ts`
  - `apps/worker/test/routes/pubsub-listener.test.ts`
  - `apps/worker/test/plugins/pubsub.test.ts`

### Update 2026-03-21: Kompensation bei terminalem Worker-Fehler

- **Kontext:** Bei terminalen Business-Fehlern (z.B. `P0001` Event nicht gefunden) darf die Nachricht nicht erneut dauerhaft redelivered werden, gleichzeitig muss eine zuvor in der API gesetzte Reservation korrekt freigegeben werden.
- **Entscheidung:** Der Worker fuehrt im terminalen Fehlerpfad eine atomare Redis-Kompensation aus (`DEL reservationKey` + `INCR available`) und ACKt nur bei erfolgreicher (oder bereits erfolgter) Freigabe.
- **Begruendung:** So bleibt der Availability-Counter konsistent ohne Double-Increment bei Redelivery. Falls die Kompensation technisch fehlschlaegt, wird NACK gesendet, damit ein Retry die Freigabe nachholen kann.
- **Umsetzung:**
  - `apps/worker/src/routes/pubsub-listener.ts`
  - `apps/worker/src/plugins/redis.ts`
  - `apps/worker/test/routes/pubsub-listener.test.ts`

### Update 2026-03-21: Worker-Idempotenz via `orderId`

- **Kontext:** Pub/Sub liefert Nachrichten mindestens einmal aus. Bei Redelivery derselben `orderId` darf der Worker keinen zweiten DB-Write ausfuehren.
- **Entscheidung:** Der Worker verwendet Redis-Keys pro `eventId` + `orderId` fuer Idempotenz:
  - `processing`: kurzlebiger Lock waehrend aktiver Verarbeitung
  - `processed`: Marker fuer bereits final verarbeitete Orders
- **Begruendung:** Redeliveries mit vorhandenem `processed`-Marker werden sofort ge-ACKt, ohne erneuten DB-Aufruf. Gleichzeitige Zustellungen derselben Order konkurrieren ueber den `processing`-Lock; nicht gewinnende Zustellungen werden ge-NACKt und spaeter erneut zugestellt.
- **Umsetzung:**
  - `packages/types/src/redis-keys.ts`
  - `packages/env/src/index.ts`
  - `apps/worker/src/routes/pubsub-listener.ts`
  - `apps/worker/test/routes/pubsub-listener.test.ts`

### Update 2026-07-14: Idempotenz-Schicht = DB-Transaktion; `processing`-Lock entfernt

- **Kontext:** Die `buy_ticket`-SQL-Function (Migration 0008) ist eine einzelne Transaktion mit `INSERT INTO orders … ON CONFLICT (id) DO NOTHING`, die bei Duplikaten das existierende Ticket zurueckliefert — sie ist damit bereits vollstaendig idempotent und nebenlaeufigkeitssicher. Der Redis-`processing`-Lock duplizierte diese Garantie: Sein einziger Effekt war, dass parallele Doppel-Zustellungen sofort ge-NACKt wurden und heiss rotierten, statt harmlos in den `ON CONFLICT`-Pfad zu laufen (vgl. `docs/ANALYSIS-STANDARD-FLOW.md`, Befund D1 / Massnahme 4).
- **Entscheidung:** Der `processing`-Lock entfaellt ersatzlos (Key-Familie, SET-NX-Erwerb, Release im `finally`, Lock-Conflict-NACK-Pfad, `processing_lock_conflicts_total`-Metrik samt Dashboard-Panels, `REDIS_WORKER_PROCESSING_LOCK_TTL_SECONDS`). Die Idempotenz-Garantie traegt explizit die DB-Transaktion. Der `processed`-Marker **bleibt** als reine Redis-Optimierung: Redeliveries werden weiterhin sofort ge-ACKt und sparen den 1-s-Payment-Sleep plus DB-Roundtrip.
- **Begruendung:** Das Learning "Idempotenz via `orderId`" wird nicht verletzt, sondern in die Schicht verlagert, die es laengst implementiert. Parallele Doppel-Zustellungen (selten) serialisieren an der Row-Lock der ersten `INSERT` und landen im Conflict-Pfad — Ergebnis: beide Zustellungen werden als `completed` ge-ACKt, kein doppelter `sold_count`, kein NACK-Hot-Loop. Weniger Zustaende, weniger Fehlerpfade, 1 Redis-Roundtrip weniger vor jedem DB-Write.
- **Umsetzung:**
  - `apps/worker/src/lib/handle-buy-ticket-message.ts` (kein `finally`/Lock-Release mehr)
  - `apps/worker/src/lib/redis-scripts.ts` (`beginOrderProcessing`-Script entfaellt, Finalize ohne Lock-DEL)
  - `apps/worker/src/routes/pubsub-listener.ts` / `apps/worker/src/lib/metrics.ts`
  - `packages/types/src/redis-keys.ts` / `packages/env/src/index.ts` / `.env.test`
  - `monitoring/grafana/provisioning/dashboards/worker-reliability.json`
  - `docs/ARCHITECTURE.md` (Key-Lifecycle- und ACK/NACK-Tabelle)

---

## ADR-005: Redis als Read-Cache

- **Datum:** 2026-02-24
- **Kontext:** Die API muss Ticket-Verfügbarkeiten in Sub-Millisekunden-Bereich liefern. Direkte DB-Reads unter Last sind zu langsam und überlasten PostgreSQL.
- **Entscheidung:** Cloud Memorystore (Redis) als exklusive Read-Quelle für die API. Worker aktualisiert den Cache nach erfolgreichen DB-Writes.
- **Begründung:** Redis liefert konsistente Reads im Mikrosekunden-Bereich. Atomic Decrement (`DECR`) verhindert Overselling. Eventual Consistency ist akzeptabel für Verfügbarkeitsanzeige.
- **Alternativen:** DB-Read-Replicas (teurer, höhere Latenz), Application-Level Cache (nicht cluster-fähig).

### Update 2026-03-15: Event-spezifische Redis-Key-Namenskonvention

- **Kontext:** Globale Redis-Keys (`tickets:total`, `tickets:available`) mischen bei mehreren Events die Verfuegbarkeiten und erschweren parallele Sales.
- **Entscheidung:** Ticket-Counter werden event-spezifisch gespeichert: `tickets:event:{eventId}:total` und `tickets:event:{eventId}:available`.
- **Begruendung:** Klare Isolation pro Event, korrekte Availability-Reads bei Multi-Event-Szenarien, und weniger Risiko fuer Key-Kollisionen.
- **Umsetzung:** API nutzt ab sofort event-spezifische Keys in Buy-/Availability-/Reset-Flow.

### Update 2026-03-15: Zentrales Redis-Key-Naming-Utility

- **Kontext:** Redis-Key-Strings wurden initial service-lokal gepflegt. Dadurch steigt bei weiteren Flows (z.B. Kompensation im Worker) das Risiko fuer Tippfehler und Drift zwischen API und Worker.
- **Entscheidung:** Redis-Key-Namen werden zentral in `@repo/types/redis-keys` definiert und in den Services importiert, statt lokal als String-Literale gepflegt.
- **Begruendung:** Ein gemeinsamer, typisierter Einstiegspunkt reduziert Drift, vereinfacht Refactorings und erzwingt konsistente Key-Schemata ueber Service-Grenzen hinweg.
- **Umsetzung:** Shared Utility in `packages/types/src/redis-keys.ts`; API-Routen verwenden den Import aus `@repo/types/redis-keys`.

### Update 2026-03-15: Atomare Reservierung ohne Negative Counter

- **Kontext:** Der bisherige Buy-Flow verwendete `DECR` mit nachgelagertem Rollback bei negativen Werten. Dadurch wurde kurzfristig auch bei Sold-Out dekrementiert und erst danach kompensiert.
- **Entscheidung:** Die API reserviert Tickets atomar per Redis-Lua-Skript: dekrementiere nur, wenn `available > 0`, sonst liefere sofort Sold-Out ohne Counter-Aenderung.
- **Begruendung:** Striktere Sold-Out-Korrektheit unter hoher Konkurrenz, kein temporaer negativer Zaehlerstand und keine unnoetige Kompensationsoperation im Konfliktfall.
- **Umsetzung:** `apps/api/src/routes/api/tickets/buy.ts` nutzt `EVAL` fuer Check+Decrement in einem atomaren Redis-Schritt.

### Update 2026-03-21: Reservation-Key pro Order mit TTL

- **Kontext:** Nach erfolgreicher atomarer Reservierung musste der temporäre Reservierungszustand pro Kauf nachvollziehbar in Redis gehalten werden, um spaetere Kompensation/Reconcile konsistent aufbauen zu koennen.
- **Entscheidung:** Die API schreibt pro Kauf einen Reservation-Key `tickets:event:{eventId}:reservation:{orderId}` mit TTL in Redis.
- **Begruendung:** Die explizite Reservation entkoppelt temporaeren Kaufzustand von persistenten Orders und laesst stale Reservierungen automatisch auslaufen. Bei Publish-Fehlern wird die Reservation sofort geloescht und der Availability-Counter per `INCR` kompensiert.
- **Umsetzung:**
  - `packages/types/src/redis-keys.ts`
  - `packages/env/src/index.ts`
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/api/test/routes/tickets.buy.test.ts`

### Update 2026-07-12: Reserve+Reservation+Pending als ein atomares Lua-Script (EVALSHA)

- **Kontext:** Der Buy-Hot-Path bezahlte drei sequenzielle Redis-Roundtrips (EVAL Check+DECR, SET Reservation-Key, SET Pending-Order) und brauchte einen mehrstufigen manuellen Rollback fuer den Zwischenzustand "Reservation gesetzt, Pending-Write fehlgeschlagen". `redis.eval()` uebertrug zudem den Script-Text bei jedem Request neu (vgl. `docs/ANALYSIS-STANDARD-FLOW.md`, Massnahme 1).
- **Entscheidung:** Check+DECR, Reservation-Key und Pending-Order-Key laufen in **einem** Lua-Script, registriert via ioredis `defineCommand` (EVALSHA mit automatischem Fallback). Der einzige verbleibende Fehlerpfad (Pub/Sub-Publish fehlgeschlagen) wird durch ein ebenso atomares Gegen-Script kompensiert: `DEL reservation` → `INCR available` nur bei tatsaechlich geloeschter Reservation → `DEL` Pending-Order.
- **Begruendung:** 3→1 Roundtrip pro Kauf im API-Hot-Path, keine partiellen Zwischenzustaende und kein mehrstufiger Rollback-Code mehr; das Gegen-Script ist idempotent (kein Double-Increment bei Wiederholung). Die Semantik aus dem ADR-017-Update 2026-04-22 (Inventory-Rollback garantiert, Pending-Cleanup darf es nicht blockieren) bleibt erhalten und wird stärker: alles ist ein atomarer Schritt.
- **Cluster-Caveat:** Das Script mischt Hash-Slots (`tickets:event:…` und `orders:…`) — zulaessig auf nicht-geclustertem Memorystore/Redis. Falls Redis Cluster je ein Thema wird, sind Hash-Tags einzuplanen und dieses ADR zu aktualisieren.
- **Umsetzung:**
  - `apps/api/src/lib/redis-scripts.ts`
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/api/test/routes/tickets.buy.test.ts`
  - `tests/e2e/test/buy-order-flow.test.ts` / `buy-order-flow.failure.test.ts`

---

## ADR-006: Prometheus + Grafana für Monitoring

- **Datum:** 2026-02-24
- **Kontext:** Lasttest-Ergebnisse müssen visuell dokumentiert werden für das GitHub README. Das System muss unter Last beobachtbar sein. Lokales Development braucht ein kostenloses, leichtgewichtiges Setup.
- **Entscheidung:** Prometheus für Metrics Collection (via `prom-client` in Fastify), Grafana für Dashboards. Lokal via Docker Compose. k6 exportiert direkt an Prometheus → Live-Visualisierung in Grafana.
- **Begründung:** Offener Standard, kostenlos, riesiges Ecosystem. k6 hat native Prometheus-Integration. Grafana-Dashboards können als JSON exportiert und im Repo versioniert werden. OpenTelemetry wurde bewusst weggelassen – Prometheus + Grafana decken den Scope (Metriken + Dashboards) vollständig ab. OTel wäre nur für Distributed Tracing über viele Services relevant, was hier Overkill ist.
- **Alternativen:** Cloud Monitoring (kostet Geld, nur in GCP), Datadog (proprietär, teuer), OpenTelemetry (zu komplex für den Scope).

---

## ADR-007: GitHub Actions für CI/CD

- **Datum:** 2026-02-24
- **Kontext:** Automatisierte Quality Gates (lint, typecheck, build) sind notwendig, um Code-Qualität im Monorepo sicherzustellen.
- **Entscheidung:** GitHub Actions mit Turborepo-Cache für lint, typecheck und build.
- **Begründung:** Native GitHub-Integration. Kostenlose Minuten für Open-Source-Repos. Turborepo-Cache beschleunigt CI-Runs erheblich.
- **Alternativen:** GitLab CI (anderer Hoster), Cloud Build (GCP-only Lock-in).

### Update 2026-04-19: Node-Kompatibilitaetsmatrix und primäre Test-Runtime

- **Kontext:** Das Projekt war bisher praktisch auf Node 24 festgelegt. Gewuenscht war eine explizite Kompatibilitaetsabsicherung fuer eine weitere LTS-Linie, ohne den stabilen Hauptpfad zu verwässern.
- **Entscheidung:**
  - CI-Quality-Gates (Guardrails, Lint, Typecheck, Build) laufen als Matrix auf Node 22 und Node 24.
  - Die komplette Test-Suite laeuft weiterhin auf Node 24 als primaerer Runtime.
  - Engine-Constraint im Root-Workspace wird auf `>=22` gesetzt.
- **Begruendung:** So wird echte Laufzeit-Kompatibilitaet frueh erkannt, waehrend der Haupttestpfad stabil und reproduzierbar auf der primären Runtime bleibt.
- **Umsetzung:**
  - `.github/workflows/ci.yml`
  - `package.json`
  - `docs/REQUIREMENTS.md`
  - `docs/DEBUGGING.md`

---

## ADR-008: Zod für Schema Validation & DTOs

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

---

## ADR-009: Husky für Git Hooks

- **Datum:** 2026-02-24
- **Kontext:** Code-Qualität soll lokal vor Commit/Push sichergestellt werden, ohne dass Entwickler manuell Befehle ausführen müssen. CI soll nicht der erste Ort sein, an dem Fehler auffallen.
- **Entscheidung:** Husky mit zwei Hooks: `pre-commit` (format), `pre-push` (lint + typecheck). Build läuft nur in der CI-Pipeline.
- **Begründung:** Format beim Commit hält Diffs sauber. Lint + Typecheck beim Push verhindert kaputte Pushes. Build nur in CI, um lokale Wartezeiten kurz zu halten. Turbo-Cache macht wiederholte Runs fast instant.
- **Alternativen:** lefthook (weniger verbreitet), simple-git-hooks (weniger Features), nur CI (Feedback-Loop zu lang).

---

## ADR-010: Terraform für Infrastructure as Code (IaC)

- **Datum:** 2026-02-25
- **Kontext:** Das Projekt soll realistisch in der Google Cloud (GKE, Cloud SQL, Memorystore, Pub/Sub) laufen. Für das Portfolio und die Reproduzierbarkeit muss das Infrastruktur-Setup code-basiert, versioniert und wiederholbar sein.
- **Entscheidung:** Terraform für das gesamte Cloud-Ressourcen-Management. Kubernetes-Manifeste werden über klassische YAML-Dateien (oder Helm) via Kubeconfig angewendet, nachdem Terraform den GKE Cluster provisioniert hat.
- **Begründung:** Terraform ist der unangefochtene Industrie-Standard für Cloud-agnostische, aber Cloud-native Infrastruktur. Es ermöglicht ein sauberes Setup von VPCs, IAM und den gemanagten Services (Cloud SQL, Redis, Pub/Sub).
- **Alternativen:**
  - _Google Cloud Deployment Manager:_ Veraltet, wird kaum noch genutzt.
  - _Pulumi:_ Moderner (TypeScript), aber Terraform ist aktuell noch der de-facto Standard, den Recruiter/Seniors bevorzugen.
  - _ClickOps (GCP Console):_ Nicht reproduzierbar, keine Versionierung (absolutes No-Go für ein Showcase-Projekt).

  ***

  ## ADR-021: Direkte Backend-Tests via `node:test` und native TypeScript-Quellen
  - **Datum:** 2026-04-21
  - **Kontext:** Der bisherige lokale Testpfad fuer API und Worker war durch Shared Runner, `ts-node/esm`, spaeter `tsx` und einen diagnostischen Vitest-Zweig unnötig komplex. Die Testlogik selbst war schnell, aber Loader-, Worker- und Teardown-Pfade erzeugten wiederholt 15- bis 30-sekündige Ausreisser. Besonders problematisch waren Runtime-Importe fuer reine Typ-Symbole, Dist-Kopplung in `@repo/db` und parallele Root-Orchestrierung in CI-aehnlichen Umgebungen.
  - **Entscheidung:** API, Worker und `@repo/db` fuehren ihre Backend-Tests paketlokal direkt ueber `node:test` gegen native `.ts`-Quellen mit `--conditions=source` aus. Relative Source-Imports werden als `.ts` gepflegt und beim Build per TypeScript auf `.js` umgeschrieben. Coverage nutzt fuer API und Worker den nativen Node-Test-Coverage-Pfad und bleibt fuer `@repo/db` beim stabileren `c8`-Pfad. Das lokale Root-Kommando `pnpm test` orchestriert die Paketskripte ueber Turborepo im Stream-Modus mit `--concurrency=1`.
  - **Begruendung:** Diese Variante entfernt sowohl `tsx` als auch Vitest aus dem Backend-Test-Hot-Path, hält die Runtime maximal nah an produktivem Node.js und vermeidet Dist-Artefakt-Abhaengigkeiten fuer normale Testlaeufe. Die verbleibenden Fastify-Lifecycle-Smoke-Tests wurden aus den kritischen Backend-Pfaden entfernt beziehungsweise auf pure Funktionen reduziert, weil genau diese Mini-Suites die 15-Sekunden-Ausreisser erneut triggern konnten. Paketlokale Skripte bleiben direkt und nachvollziehbar; Root-Orchestrierung bleibt Aufgabe von Turborepo, nicht eines weiteren Test-Runners.
  - **Alternativen:**
    - `ts-node/esm` mit Shared Runner (zu komplex und instabil)
    - `node --import tsx --test` (einfacher als `ts-node/esm`, aber weiterhin mit sporadischen 15-Sekunden-Teardown-Ausreissern)
    - vollstaendige Migration auf Vitest fuer Backend-Pakete (diagnostisch hilfreich, aber fuer diesen Scope kein stabilerer Fast-Path)
  - **Umsetzung:**
    - `package.json`
    - `apps/api/package.json`
    - `apps/worker/package.json`
    - `packages/db/package.json`
    - `packages/typescript-config/base.json`

---

## ADR-011: Event Capacity Model vs. Pre-generated Tickets

- **Datum:** 2026-02-25
- **Kontext:** 1.000.000 Tickets sollen verkauft werden, personalisiert mit Name, Geburtsdatum, Adresse etc. Die Pre-Generation von 1 Million leeren Rows bläht die Datenbank extrem auf und Updates darauf sind ineffizient.
- **Entscheidung:** Wir nutzen ein Capacity-Modell kombiniert mit Ticket-Generierung on-the-fly (`INSERT` statt `UPDATE`).
- **Begründung:** Eine zentrale Tabelle `events` speichert `total_capacity` und `sold_capacity`. Der Redis-Cache hält initial die volle Kapazität als Integer und zählt pro Kauf atomar herunter (`DECR`). Erst wenn der Kauf via Pub/Sub im Worker bearbeitet wird, erfolgt ein `INSERT` eines neuen, fertig personalisierten Tickets (inkl. generierter UUID als Ticket-Code/QR-Code-Ersatz) in die Tabelle `tickets` und ein atomares Erhöhen der `sold_capacity`. So enthält die Datenbank nur so viele Ticket-Rows, wie tatsächlich verkauft wurden.
- **Alternativen:** 1 Mio. leere Rows vorab generieren (ineffizient für RDBMS, riesiger Speicher-Overhead und Table Scans), NoSQL mit Object-Appends (passt nicht zu unseren relationalen ACID-Anforderungen).

---

## ADR-012: Guest Checkout (Keine Authentifizierung)

- **Datum:** 2026-02-25
- **Kontext:** Authentifizierung (OAuth, NextAuth) lenkt vom Kern-Szenario (High-Concurrency, Async Writes) ab und erhöht die Komplexität des Beispielprojekts.
- **Entscheidung:** Keine E-Mail/Passwort- oder Social-Login Authentifizierung. Es wird ein Guest-Checkout implementiert.
- **Begründung:** Die zu personalisierenden Käuferdaten (Vorname, Adresse, etc.) werden direkt im POST-Request beim Ticket-Kauf mitgeliefert. Das Frontend generiert eine lokale Request/Session-UUID um per Polling abfragen zu können, ob das asynchrone Ticket erfolgreich generiert wurde. Der Scope bleibt somit streng fokussiert auf System-Performance.
- **Alternativen:** Vollständige Auth via Supabase/NextAuth (zu viel Feature-Creep).

---

## ADR-013: Payment Flow Mocking

- **Datum:** 2026-02-25
- **Kontext:** Echte Zahlungsanbieter (Stripe, PayPal) führen bei extremer Last durch API-Rate-Limits oft zu Engpässen.
- **Entscheidung:** Der Payment-Flow wird im Worker durch eine künstliche Latenz (z.B. nicht-blockierender Sleep von 500ms bis 1500ms via `setTimeout` aus `node:timers/promises`) simuliert.
- **Begründung:** Diese simulierte Latenz demonstriert den Hauptvorteil unserer asynchronen Pub/Sub-Architektur perfekt: Selbst wenn die "externe Zahlungsabwicklung" extrem langsam wird und den Worker verlangsamt, kann die Fastify API im Frontend sofort das HTTP 202 (Accepted) Signal geben. Die Pub/Sub Queue fängt den Rückstau ab. Bei einer synchronen Architektur würden an dieser Stelle alle Requests in ein Timeout laufen. Da `setTimeout` via Promises den Event-Loop nicht blockiert (kein Busy Wait), kann der Worker effizient tausende asynchrone Zahlungen gleichzeitig "abwarten", ohne CPU-Ressourcen zu verschwenden.
- **Alternativen:** Keine Verzögerung (unrealistisch für echtes Ticketing), Echter Payment-Provider Testmodus (deren Rate Limits würden den k6 Last-Test zerstören oder fälschen).

---

## ADR-014: Wahl des Cloud Providers (GCP vs. EU-Provider)

- **Datum:** 2026-02-27
- **Kontext:** Es wurde evaluiert, ob das Projekt anstatt auf einer US-Cloud (GCP) auf einem europäischen Provider (wie Scaleway, Exoscale, Hetzner, OVHcloud) gehostet werden sollte, primär aus Datenschutzgründen (DSGVO/GDPR) und um Vendor-Lock-in zu vermeiden.
- **Entscheidung:** Das Projekt verbleibt auf der Google Cloud Platform (GCP).
- **Begründung:** Da es sich um ein Demo-/Portfolio-Projekt handelt, existieren keine realen Nutzerdaten, weshalb DSGVO-Lokalität (Data Residency in der EU) hier keinen echten praktischen Vorteil bietet. Im Gegenzug bietet GCP entscheidende Vorteile für ein Portfolio-Projekt:
  - **Managed Services "Out-of-the-box":** GCP bietet mit Pub/Sub einen hochskalierbaren, komplett gemanagten Message Broker, der perfekt für unser asynchrones Write-Pattern ist. Bei EU-Providern müssten wir oft selbst Kafka/RabbitMQ managen oder auf Drittanbieter (wie Aiven bei Exoscale) ausweichen.
  - **Enterprise-Relevanz:** Erfahrung mit großen Hyperscalern (GCP, AWS, Azure) und deren proprietären Systemen (wie Cloud Spanner, Pub/Sub) wird von Recruitern und Enterprise-Unternehmen oft stärker gewichtet als Erfahrung mit kleineren EU-Clouds.
  - Das Setup über Terraform zeigt, dass wir Infrastructure-as-Code beherrschen, was die theoretische Portabilität beweist, ohne dass wir die Nachteile des "Self-Hostings" von Message Queues in Kauf nehmen müssen.
- **Alternativen (Evaluierte EU-Provider):**
  - _Scaleway (FR):_ Modern, gutes Managed Kubernetes und DBs, inkl. Messaging. Sehr nah an großen Clouds, aber weniger "Enterprise-Name-Drop"-Wert im Lebenslauf.
  - _Exoscale (CH):_ Exzellent für K8s und Datenschutz (Datencenter in Wien/München), gemanagte Services via Aiven. Leicht teurer und komplexer im Setup.
  - _Hetzner Cloud (DE):_ Unschlagbares Preis-Leistungs-Verhältnis für Compute, aber kein natives Managed Kubernetes oder Managed Message Queues. Erfordert sehr viel Eigenbau (z.B. K3s, RabbitMQ Operator), was vom Fokus (High-Frequency Backend Logik) ablenkt.
  - _OVHcloud (FR):_ Großer Player, aber stellenweise altbackene APIs und Terraform-Provider Eigenheiten.

---

## ADR-015: Custom Error Classes & Secure Error Handling

- **Datum:** 2026-03-04
- **Kontext:** Die API benötigt ein verlässliches Error-Handling. Zum einen müssen erwartbare fachliche Fehler (z.B. "Tickets ausverkauft" -> 409 Conflict) strukturiert an den Client gesendet werden. Zum anderen dürfen interne Systemfehler (500 Fehler, DB Exceptions) in der Produktion niemals echte Fehlermeldungen (Information Leakage) an den Client senden.
- **Entscheidung:** Einführung von abstrakten `AppError` Klassen (in `packages/types`), die von Standard-Errors ableiten und in einem zentralen Fastify Error Handler ausgewertet werden.
- **Begründung:** Der zentrale Error Handler fängt alle Exceptions ab. Wenn `error instanceof AppError`, ist es ein "Operational Error" und darf sicher (inkl. Status Code und Message) zum Client geschickt werden. Ist es ein unbekannter Fehler und `NODE_ENV === "production"`, verdeckt der Handler die echte Nachricht mit einem generischen "Internal Server Error" 500. Das schützt interne Infrastruktur-Details.
- **Alternativen:** Try/Catch in jeder einzelnen Route (zu viel Boilerplate, fehleranfällig).

---

## ADR-016: GCP-Ready Structured Logging mit Pino

- **Datum:** 2026-03-04
- **Kontext:** Für Observability und Fehlersuche müssen Logs strukturiert in der Cloud (GCP Stackdriver / Cloud Logging) ankommen. Fastify nutzt standardmäßig Pino.
- **Entscheidung:** Pino wird so konfiguriert, dass das Standardfeld `level` (ein Integer bei Pino) zu einem GCP-kompatiblen Feld `severity` (z.B. "INFO", "ERROR") umgeschrieben wird.
- **Begründung:** Cloud Logging parst Pino's rohes JSON automatisch. Wenn jedoch das `severity`-Feld fehlt, werden alle Logs in der GCP UI standardmäßig als wertloses "DEFAULT" oder "INFO" klassifiziert, auch wenn es fatale Fehler sind. Die Mapping-Config sichert 100%ige Kompatibilität zur GCP-Log-Analyse ohne Performance-Verlust. Alle Logs enthalten zudem automatisch die Fastify `reqId`, um Requests über API und Worker tracebar zu machen.
- **Alternativen:** Winston oder Morgan statt Pino (unnötiger Overhead, Pino ist in Fastify integriert und der schnellste Node Logger), externer Log-Agent (zu viel DevOps Overhead für dieses Setup).

---

## ADR-017: Order-Status via Polling (kein SSE)

- **Datum:** 2026-03-12
- **Kontext:** Das Ticket-Kaufen ist asynchron (Pub/Sub + Worker). Der Client braucht eine verlässliche Rueckmeldung, ob der Kauf abgeschlossen ist, ohne die API-Request-Latenz zu erhoehen oder den Worker direkt mit dem Browser zu verbinden.
- **Entscheidung:** Die API liefert beim Kauf ein `orderId` (z.B. aus dem Request oder generiert) und der Client pollt einen Status-Endpunkt (`GET /api/orders/{orderId}`) bis `completed|failed` erreicht ist.
- **Begruendung:** Polling ist einfach, robust und passt zur entkoppelten Architektur. Der Worker schreibt den finalen Status in die Datenbank und materialisiert zusaetzlich ein Redis-Read-Model; die API liest fuer den Client ausschließlich aus Redis und bleibt damit komplett PostgreSQL-frei. Kein direkter Worker-Client-Kanal, keine zusaetzliche Persistenz fuer SSE-Verbindungszustand.
- **Alternativen:**
  - **Server-Sent Events:** wuerde einen dauerhaften API-Client-Kanal erfordern und zusaetzliche Infrastruktur/State-Management (Reconnect, Lastverteilung) benoetigen.
  - **WebSockets:** aehnlich wie SSE, aber komplexer im Betrieb, besonders unter Lastspitzen.
  - **Kein Status-Feedback:** schlechter UX und fuer das Demo-Szenario unzureichend.

### Update 2026-04-22: Sofort beobachtbarer Pending-Status nach `202 Accepted`

- **Kontext:** Zwischen `POST /api/tickets/:eventId/buy` und der spaeteren Worker-Persistenz existierte eine Luecke: Direkt nach `202 Accepted` war der Auftrag fuer einen geplanten `GET /api/orders/:orderId` noch nicht konsistent lesbar, weil die API keine DB schreiben darf und die Order erst im Worker entsteht.
- **Entscheidung:** Die API schreibt nach erfolgreicher Redis-Reservation einen temporaeren Pending-Status pro `orderId` in einen stabilen Redis-Key `orders:{orderId}` mit eigener Pending-TTL. Der Worker ueberschreibt denselben Key spaeter mit `completed` plus `ticketId` oder `failed` plus `failureReason` und verwendet dafuer eine laengere Final-Status-TTL. Bei Publish-Fehlern bleibt das kritische Inventory-Rollback (`reservation` loeschen + `available` kompensieren) garantiert; Order-Status-Cleanup ist nachgelagert und darf dieses Rollback nicht blockieren.
- **Begruendung:** So bleibt der Buy-Flow DB-write-frei, waehrend der spaetere Order-Read-Pfad unmittelbar nach `202 Accepted` einen stabilen Pending-Status aus Redis nutzen kann und spaeter ohne Key-Wechsel denselben Redis-Eintrag als finales Read-Model liest. Die laengere Final-Status-TTL verhindert dabei, dass `completed|failed` deutlich frueher verschwinden als die Worker-Idempotenz- und Polling-Fenster.
- **Umsetzung:**
  - `packages/types/src/redis-keys.ts`
  - `packages/types/src/tickets.ts`
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/api/test/routes/tickets.buy.test.ts`
  - `apps/worker/src/lib/handle-buy-ticket-message.ts`
  - `apps/worker/src/routes/pubsub-listener.ts`
  - `apps/worker/test/routes/pubsub-listener.test.ts`

  ***

  ## ADR-018: Ticket-Kauf via SQL-Function im Worker
  - **Datum:** 2026-03-12
  - **Kontext:** Der Worker hat zuvor eine Drizzle-Transaktion mit `INSERT` und `UPDATE` ausgefuehrt. Die Logik soll atomar und nah an der DB bleiben.
  - **Entscheidung:** Der Worker ruft eine PostgreSQL-Function `buy_ticket(event_id, first_name, last_name)` auf.
  - **Begruendung:** Die DB kapselt die gesamte Write-Logik in einer atomaren Operation. Das reduziert Roundtrips und vereinfacht den Worker-Code.
  - **Alternativen:** Drizzle-Transaktion im Worker (mehr ORM-Code, gleiche Semantik), separate Stored Procedures pro Schritt (mehr Komplexitaet).

---

## ADR-019: TypeScript CLI via tsgo

- **Datum:** 2026-03-21
- **Kontext:** Monorepo-Builds und Typechecks laufen bisher ueber `tsc` und zeigen bei Full-Runs vermeidbare Laufzeitkosten. Das Projekt nutzt bereits `@typescript/native-preview` und will die Compiler-CLI schrittweise auf `tsgo` migrieren.
- **Entscheidung:** Direkte `tsc`-Aufrufe in Workspace-Skripten werden weitgehend durch `tsgo` ersetzt (`build`, `check-types`, Teile von `test` und `watch`).
- **Begruendung:** `tsgo` ist kompatibel zum bisherigen CLI-Flow und reduziert die Dauer von uncacheten Full-Builds. Die Umstellung erfolgt inkrementell, um Risiko in Dev-Watch-Flows klein zu halten. Eine temporaere Ausnahme bleibt fuer `apps/web` `check-types`, weil Side-Effect-CSS-Imports (`./globals.css`) im aktuellen Preview-Stand noch nicht sauber aufgeloest werden.
- **Alternativen:**
  - Bei `tsc` bleiben (kein Performance-Gewinn in CLI-Builds).
  - Big-Bang-Migration inklusive aller Watch/Restart-Workflows (hoeheres Integrationsrisiko).
- **Status:** Teilweise fertig
- **TODO-Mapping:** `docs/TODO.md` Phase 1 Tooling (`tsc`-CLI weitgehend migriert, Ausnahmen fuer Web-Checktypes und `tsc-watch` offen)

### Update 2026-04-21: Konsistenter Runtime-Packaging-Pfad fuer Shared-Pakete

- **Kontext:** Gebaute Artefakte von API und Worker importierten zur Laufzeit weiterhin `@repo/env` und `@repo/types` ueber Workspace-TypeScript-Quellen. Das funktionierte im lokalen Node-24-Pfad, war aber inkonsistent zum bereits buildbaren `@repo/db`-Paket und hielt gebaute Services implizit von Source-Exports abhaengig.
- **Entscheidung:** `@repo/env` und `@repo/types` werden als buildbare `tsgo`-Pakete mit `types`/`source`/`default`-Exports an das bestehende `@repo/db`-Muster angeglichen. Direkte `api`- und `worker`-Builds bauen ihre benoetigten Runtime-Pakete vor dem eigenen Service-Build explizit mit.
- **Begruendung:** Der source-basierte Test-Hot-Path bleibt unveraendert, waehrend gebaute Services einen konsistenten Plain-Node-Runtime-Pfad ueber `dist` erhalten. Das reduziert implizite TypeScript-Runtime-Abhaengigkeiten und vereinheitlicht das Verhalten aller Shared-Packages, die in Backend-Artefakten zur Laufzeit importiert werden.
- **Umsetzung:**
  - `packages/env/package.json`
  - `packages/types/package.json`
  - `apps/api/package.json`
  - `apps/worker/package.json`
  - `docs/REQUIREMENTS.md`
  - `docs/ARCHITECTURE.md`
  - `docs/TODO.md`

---

## ADR-020: Deterministische Tests & Debug-Guardrails

- **Datum:** 2026-03-22
- **Kontext:** Unter Node 24 + `ts-node/esm` waren glob-basierte `node --test` Aufrufe in API/Worker wiederholt instabil (opaque Top-Level-Fehler), was die Fehlersuche verlangsamt hat. Gleichzeitig wurden wiederkehrende Diagnosen oft als Inline-Einzeiler ausgefuehrt und waren dadurch schwer reproduzierbar.
- **Entscheidung:**
  - Testskripte setzen `NODE_OPTIONS=''`, um Debug-Bootloader-Injektionen als Fehlerquelle zu eliminieren.
  - Wiederkehrende Diagnosen werden als versionierte Skripte bereitgestellt (`debug:*`, inkl. Migrations- und `buy_ticket`-Vertragschecks).
  - CI fuehrt Guardrail-Checks fuer Migrations-Journal und `buy_ticket`-Vertrag vor Lint/Typecheck/Build aus.
  - Ein kurzes Runbook dokumentiert den reproduzierbaren Debug-Ablauf.
- **Begruendung:** Versionierte Debug-Skripte sparen Debug-Zeit, da sie ad-hoc Shell-Einzeiler durch wiederholbare Checks ersetzen. Fruehe CI-Guardrails verhindern Drift zwischen Drizzle-Schema, Migrationsjournal und SQL-Function-Vertrag.
- **Alternativen:**
  - Bei ad-hoc Shell-Diagnosen bleiben und nur bei Bedarf manuell debuggen (langsamer, fehleranfaelliger).
  - Nur lokale Checks ohne CI-Guardrails (Drift wird spaet erkannt).
- **Status:** Fertig
- **TODO-Mapping:** `docs/TODO.md` Phase 1 (Debug-Skripte, Runbook) + Phase 3.5 (CI-Guardrails)

### Update 2026-04-21: Direkter Testpfad ohne Shared Runner

- **Kontext:** Der zwischenzeitliche Shared Runner fuer API und Worker hat die eigentliche Ursache der Test-Langsamkeit nicht geloest, sondern die Testarchitektur weiter verkompliziert.
- **Entscheidung:** API, Worker und `@repo/db` laufen wieder direkt ueber paketlokale `node --conditions=source --test` Skripte ohne Wrapper-Entrypoints oder zentrales Runner-Skript.
- **Begruendung:** Die direkte Paket-Ausfuehrung gegen native `.ts`-Quellen ist einfacher, erklaerbarer und schneller zu debuggen als jede zentrale Sonderlogik fuer Loader, Main-Module oder paketabhaengige Branches.
- **Umsetzung:**
  - `package.json`
  - `apps/api/package.json`
  - `apps/worker/package.json`
  - `packages/db/package.json`

### Update 2026-04-20: Schneller lokaler Testpfad ohne Coverage-Instrumentierung

- **Kontext:** Die vereinheitlichten Testskripte mit `c8` lieferten reproduzierbare Coverage-Berichte, waren im lokalen Entwicklungs-Loop aber deutlich langsamer als nötig.
- **Entscheidung:** Lokale Testläufe und Coverage/CI-Läufe werden getrennt:
  - `test` in API/Worker läuft ohne Coverage-Instrumentierung (schneller Feedback-Loop).
  - `test:coverage` und `test:ci` nutzen in API/Worker die native Node-Coverage.
  - `@repo/db` bleibt fuer Coverage und `test:ci` beim stabileren `c8`-Pfad.
  - Root-Skripte und Turborepo-Tasks erhalten ein separates `test:ci`-Target mit Coverage-Outputs.
- **Begruendung:** So bleibt die lokale Iteration schnell, während CI weiterhin Coverage-Artefakte und denselben vollständigen Sicherheits-Flow nutzt.
- **Umsetzung:**
  - `apps/api/package.json`
  - `apps/worker/package.json`
  - `package.json`
  - `turbo.json`

  ### Update 2026-04-20: Deterministisches Local Reset/Seeding fuer Infrastruktur
  - **Kontext:** Fuer reproduzierbare lokale End-to-End-Tests fehlte ein einheitlicher One-Command-Reset ueber PostgreSQL, Redis und den Pub/Sub Emulator.
  - **Entscheidung:** Ein zentrales Root-Skript `pnpm run local:reset-seed` setzt alle drei lokalen Systeme auf einen definierten Fixture-Stand zurueck.
  - **Begruendung:** Einheitliche Ausgangsdaten reduzieren Debug-Zeit, verhindern Drift zwischen Teammitgliedern und verbessern die Reproduzierbarkeit von API/Worker-Tests.
  - **Umsetzung:**
    - `scripts/local/reset-seed.mjs`
    - `package.json`
    - `docs/DEBUGGING.md`

---

## ADR-022: Periodischer Reconcile-Loop im Worker (Singleton-Deployment-Strategie)

- **Datum:** 2026-05-23
- **Kontext:** Der Reconcile-Kern (`reconcileTicketAvailability`) laeuft bereits einmalig beim Worker-Start. Fuer kontinuierlichen Drift-Schutz zwischen Redis und PostgreSQL muss er auch periodisch im Betrieb laufen. Die Designfrage war: Wo laeuft der Loop, wie verhindert man ueberlappende Laeufe, wird Intervall-Steuerung fachlich oder infrastrukturell gesteuert – und was passiert, wenn mehrere Worker-Pods parallel laufen?
- **Recherche-Basis:**
  - Das Kubernetes Controller-Pattern (K8s-Doku) definiert den Reconcile-Loop als architektonisches Grundprinzip: ein Loop, der kontinuierlich Desired State vs. Current State vergleicht und bei Abweichung korrigiert. Kubernetes selbst nutzt dieses Muster intern fuer `kube-controller-manager` und `kube-scheduler`.
  - Kubernetes `coordination.k8s.io/v1 Lease`-Objekte sind der kanonische K8s-Mechanismus fuer Leader Election in HA-Setups (Workloads-Abschnitt: _"Your own workload can define its own use of Leases"_).
  - Martin Kleppmann ("How to do distributed locking"): Fuer **Effizienz-Locks** (kein Korrektheitsproblem bei doppeltem Lauf, da idempotent) reicht ein einfacher Redis `SET NX EX`. Redlock und ZooKeeper sind Overkill, wenn kein Korrektheitsverlust bei Ueberlappung eintritt.
- **Entscheidung:**
  1. Der Reconcile-Loop laeuft innerhalb des Worker-Prozesses als eigenstaendiger Lifecycle-Concern, gestartet nach dem Startup-Reconcile.
  2. **Self-scheduling `setTimeout`** (nicht `setInterval`): Naechster Lauf startet erst nach Abschluss des vorherigen. Verhindert Ueberlappung bei langsamen DB/Redis-Abfragen unter Last.
  3. **Singleton-Deployment** (`replicas: 1`): Kubernetes garantiert, dass kein zweiter Pod gleichzeitig reconciliert. Leader-Election-Code ist in dieser Phase nicht noetig.
  4. **Operator-gesteuerte Betriebsmodi** via `@repo/env`: `WORKER_RECONCILE_MODE=peak|normal`, `WORKER_RECONCILE_INTERVAL_PEAK_SECONDS` (Default: 10), `WORKER_RECONCILE_INTERVAL_NORMAL_SECONDS` (Default: 60).
  5. Sauberes Stoppen ueber Fastify `onClose`-Hook (analog zum bestehenden Pub/Sub-Subscriber-Stop).
- **Begruendung:**
  - `setInterval` wuerde Laeufe ueberlappen, wenn ein Reconcile-Lauf (DB-Read + Redis-Scan + Writes) laenger dauert als das Intervall.
  - Intervall-Steuerung ueber K8s-Auslastung (CPU/Replicas) waere der falsche Steuerkanal: K8s-Autoscaling spiegelt nicht den fachlichen Redis/DB-Drift wider. Korrekte Signale waeren Drift-Metriken, Reservation-Churn und Queue-Backlog – diese stehen erst mit Phase 4.5 (Observability) zur Verfuegung.
  - Redis `SET NX EX` Leader-Election waere fuer einen Effizienz-Lock ausreichend (Kleppmann: _"Redis shines for approximate, non-critical locks"_), aber bei Singleton-Deployment unnoetige Komplexitaet.
  - Dedizierter `reconciler`-Service (dritter Service) waere die sauberste Separation of Concerns, erhoehte aber Deployment- und Betriebskomplexitaet ohne konkreten Mehrwert solange der Worker als Singleton laeuft.
- **Eskalationspfad (Phase 5):** Wenn der Worker horizontal skaliert wird (`replicas > 1`), muss entweder Leader Election via Kubernetes Lease API (`coordination.k8s.io/v1`) eingefuehrt werden, oder der Reconciler wird als dedizierter Singleton-Service (`apps/reconciler`) ausgelagert. Beide Optionen sind gleichwertig; Entscheidung abhaengig von operativer Komplexitaet und Monitoring-Reife.
- **Alternativen (evaluiert und verworfen):**
  - `setInterval`: einfacher, aber ueberlappungsgefaehrdet bei langsamen Laeufen.
  - Redis `SET NX EX` (Effizienz-Lock): ausreichend fuer diese Klasse von Locks, aber bei Singleton redundant.
  - Kubernetes Lease API jetzt: kanonisch fuer HA-Multi-Replica, Eskalationspfad Phase 5.
  - Dedizierter Reconciler-Service jetzt: beste Separation, erhoehte Komplexitaet ohne Mehrwert bei Singleton-Worker.
  - Intervall aus K8s-Metriken (z.B. Pod-Anzahl, CPU): falscher Steuerkanal – infrastrukturelle Last korreliert nicht mit fachlichem Drift.

---

## ADR-023: E2E-Observability — queuedAt-Timestamp, Latenz-Histogramm und Redis-DB-Drift

- **Datum:** 2026-05-31
- **Kontext:** Nach Abschluss von Phase 3.5 ist der vollständige Async-Flow (API → Pub/Sub → Worker → PostgreSQL → Redis) messbar. Zwei Kernfragen: Wie messen wir End-to-End-Latenz ohne synchrone Kopplung von API und Worker? Und wie erkennen wir Redis-DB-Konsistenz-Drift ohne kontinuierliche DB-Scans?
- **Entscheidung:**
  1. `queuedAt: Date.now()` wird beim Pub/Sub-Publish in das `BuyTicketEvent`-Payload eingebettet. Der Worker misst bei Abschluss die Differenz als `order_e2e_latency_seconds`-Histogram mit Labels `event_id` und `status` (`completed` | `failed`).
  2. Nach jedem Reconcile-Lauf schreibt der Worker einen `redis_db_drift_tickets`-Gauge pro Event: `redis_available − (total_capacity − sold_count − active_reservations)`.
- **Begruendung:**
  - `queuedAt` im Payload ist die einzige vollstaendig entkoppelte Methode zur E2E-Latenz-Messung, die weder einen gemeinsamen State zwischen API und Worker noch synchrone Koordination erfordert. Der Timestamp reist im Pub/Sub-Payload mit und ist damit sowohl bei direkter Zustellung als auch bei Redeliveries korrekt.
  - Die Drift-Metrik ermoeglicht Alerting auf Konsistenz-Abweichungen, ohne kontinuierliche DB-Scans auszuloesen — der Reconcile-Loop berechnet die Differenz ohnehin als Nebenprodukt seiner Arbeit.
  - Beide Metriken sind direkt in Prometheus integriert und erfordern keine zusaetzliche Infrastruktur.
- **Alternativen:**
  - Distributed Tracing via OpenTelemetry: vollstaendige Trace-Propagation ueber API, Pub/Sub und Worker waere ideal fuer Debugging, aber fuer diesen Scope deutlich zu viel Infrastruktur-Overhead (eigener Collector, Jaeger/Tempo) — vgl. ADR-006.
  - Redis `OBJECT IDLETIME` / Keyspace-Notifications als Drift-Sensor: kein Aggregate-Blick, keine Event-Isolation, nicht einfach als Prometheus-Gauge abbildbar.
  - Gesonderter Drift-Checker-Job: wuerde zusaetzliche DB-Reads ausloesen und ist schlechter in den Reconcile-Loop integriert als ein Nebenprodukt-Gauge.
- **Umsetzung:**
  - `packages/types/src/tickets.ts` (`queuedAt` in `BuyTicketEvent`)
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/worker/src/lib/handle-buy-ticket-message.ts`
  - `apps/worker/src/lib/reconcile-ticket-availability.ts`
  - `apps/worker/src/lib/metrics.ts`
- **Nachtrag (2026-07-15, nach Baseline A):** Die Histogram-Buckets endeten bei 30 s. Baseline A hatte ~406 s mittlere E2E-Latenz, wodurch praktisch alle Messungen in den `+Inf`-Overflow-Bucket fielen und p95/p99 flach bei 30 s klippten. Buckets auf `[…, 30, 60, 120, 180, 300, 450, 600]` erweitert, damit Queue-Druck jenseits von 30 s aufloesbar ist. Zusaetzlich das Grafana-Panel „Completion Rate (5m)“ in „Worker/API Throughput Ratio (5m)“ umbenannt: Der Wert ist kein Completion-Wahrscheinlichkeit, sondern das Verhaeltnis rollierender Completion-/Accept-Fenster und darf im Drain legitim > 100 % liegen (Baseline A zeigte 960 %) — daher `max: 1` entfernt und die Schwellen auf „< 1 = faellt zurueck / ≥ 1 = draint Backlog“ gesetzt. Legenden-`sum` auf den kumulativen Panels (Order Lifecycle, Worker Reliability) entfernt, da Grafana jeden geplotteten `increase($__range)`-Punkt aufsummierte und damit unsinnige Werte (11,7 Mio.) statt des Range-Increase (`last`) anzeigte.
- **Nachtrag (2026-07-17, Reserve/Pay-Split ADR-028):** `queuedAt` wird nicht mehr im Buy gesetzt, sondern erst beim Publish in der Pay-Route (`apps/api/src/routes/api/orders/pay.ts`). Damit misst `order_e2e_latency_seconds` **nur noch Publish→Persist** — die Checkout-Denkzeit des Nutzers (Reserve bis Bezahlen) faellt bewusst heraus, und mit dem entfernten Worker-Sleep (ADR-028) gibt es auch keine kuenstliche Latenz mehr. Die Messung kollabiert damit von Baseline As ~406 s in den unteren Millisekundenbereich; die nach Baseline A auf 600 s getunten Buckets sind auf eine Millisekunden-Aufloesung (`[0.001 … 10]`) zurueckgenommen. Die Buy-Route ist entsprechend nicht mehr Umsetzungsstelle des `queuedAt`-Timestamps (siehe „Umsetzung“ — jetzt Pay-Route). Neuer Checkout-Funnel (`reservations_created` → `payments_confirmed` → `checkouts_cancelled`) im Order-Lifecycle-Dashboard, Abandon-Rate per PromQL abgeleitet.

---

## ADR-024: Sale-Unlock-Gate (425 Too Early)

- **Datum:** 2026-07-15
- **Kontext:** Der lokale Lasttest sollte einen echten Ticket-Sale nachbilden — Nutzer stroemen vor Verkaufsstart auf die Seite (Warm-Up/Pre-Sale-Hype), koennen aber noch nichts kaufen. Bisher war der Verkauf ab `t=0` offen; es gab keinen Mechanismus, Kaufversuche vor einem definierten Zeitpunkt abzulehnen.
- **Entscheidung:** Ein neuer Redis-Key `tickets:event:{eventId}:opensAt` (Unix-Ms-Timestamp) wird als **erster Check** im bestehenden atomaren Reserve-Lua-Script gepruft (`apps/api/src/lib/redis-scripts.ts`). Ist `opensAt > 0` und liegt der uebergebene `nowMs` davor, bricht das Script sofort ohne jeden Schreibzugriff ab und liefert den Sentinel `-2`. Die API mappt das auf eine neue `TooEarlyError` (HTTP 425 Too Early, RFC 8470). Fehlt der Key oder ist er `0`, gilt das Event weiterhin als sofort offen (Rueckwaertskompatibilitaet fuer alle bestehenden Flows und Tests).
- **Begruendung:**
  - **Ein Roundtrip, keine Race Condition:** Der Check laeuft im selben atomaren Script wie Sold-Out-Check + Reservierung. Eine separate Pruefung davor (z.B. ein eigener Redis-`GET` oder ein DB-Read) wuerde entweder einen zusaetzlichen Roundtrip auf dem Hot-Path kosten oder ein TOCTOU-Fenster zwischen Check und Reservierung oeffnen.
  - **Redis-only, passend zur bestehenden Architektur:** Die Gate-Entscheidung ist reiner Lesezugriff auf einen Redis-Key, kein DB-Write und kein DB-Read — die Regel "API liest Verfuegbarkeiten ausschliesslich aus Redis" (ADR-005) bleibt vollstaendig intakt, es entsteht keine neue Abhaengigkeit.
  - **425 statt 409/403:** RFC 8470 beschreibt 425 Too Early exakt fuer "Server lehnt eine Anfrage ab, die er (noch) nicht verarbeiten will, der Client soll es spaeter erneut versuchen" — semantisch praeziser als eine Wiederverwendung von 409 (Conflict, bereits fuer Sold-Out belegt) oder 403 (Forbidden, impliziert keine zeitliche Bedingung).
  - **`nowMs` statt Redis-Serverzeit:** Der Zeitvergleich nutzt den vom Aufrufer uebergebenen `Date.now()`-Wert (`ARGV[5]`) statt `redis.call("TIME")` im Script, um von Redis' Replikationsverhalten fuer Lua-Scripte unabhaengig zu bleiben und denselben Zeitstempel auch fuer `queuedAt` im Pub/Sub-Payload wiederzuverwenden (ein `Date.now()`-Aufruf pro Request statt zwei).
- **Bekannte Einschraenkung (Cloud):** Da `nowMs` aus der Uhr des jeweiligen API-Prozesses stammt, oeffnet sich das Gate bei mehreren API-Replicas exakt so praezise wie deren Uhren synchron sind — bei Uhr-Drift zwischen Pods faellt der Verkaufsstart pro Pod um die Drift-Spanne unterschiedlich. Lokal (ein Prozess) irrelevant; in GKE ist NTP-Sync (Standard) fuer die typischerweise geforderte Sekunden-Genauigkeit ausreichend. Ist sub-sekunden-exakter, prozessuebergreifend identischer Unlock noetig, muesste stattdessen `redis.call("TIME")` (eine autoritative Uhr) genutzt werden — mit dem oben genannten Trade-off.
- **Alternativen:**
  - Separater Redis-`GET` vor dem Reserve-Script: einfacher zu lesen, aber ein zusaetzlicher Roundtrip und ein Race-Fenster zwischen Check und `DECR`.
  - Gate in PostgreSQL (`events.opens_at`-Spalte, Check in `buy_ticket`): wuerde einen DB-Read in den API-Hot-Path zwingen — widerspricht ADR-005.
  - HTTP 403 Forbidden statt 425: wiederverwendet eine bestehende Error-Klasse ohne neue Abstraktion, aber verliert die "retry later" Semantik, die 425 explizit transportiert.
- **Umsetzung:**
  - `packages/types/src/redis-keys.ts` (`opensAt`)
  - `packages/types/src/errors.ts` (`TooEarlyError`)
  - `apps/api/src/lib/redis-scripts.ts`
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/api/test/routes/tickets.buy.test.ts`
  - `scripts/local/reset-seed.mjs` (`SALE_OPENS_IN_SECONDS`)
  - `docs/ARCHITECTURE.md` (Happy-Path, Redis-Key-Lifecycle)

---

## ADR-025: Reaktive Sold-Out-Orchestrierung im lokalen Lasttest

- **Datum:** 2026-07-15
- **Kontext:** Der bisherige `load-tests/spike.js` fuhr ein rein zeitbasiertes RPS-Profil ueber sechs feste Phasen. Da der Verkauf ab `t=0` offen war und die Phasenuebergaenge unabhaengig vom tatsaechlichen `available`-Stand liefen, verkaufte sich das 1M-Ticket-Kontingent je nach lokal erreichtem Durchsatz zu einem zufaelligen Zeitpunkt aus — haeufig mitten in einer Hoch-RPS-Phase statt am Uebergang zu einer bewusst niedrigeren "Sold Out"-Phase, wie es das urspruengliche Lastprofil (siehe ARCHITECTURE.md) vorsah.
- **Entscheidung:**
  1. Der Lasttest wird in zwei k6-Scripte gesplittet: `load-tests/spike-phase-a.js` (Warm-Up 1.000 RPS flat/45s → Ramp-Up 1.000→5.000 RPS/45s → Sustain 5.000 RPS mit 15-min-Sicherheitsnetz) und `load-tests/spike-phase-b.js` (Cool-Down 1.000 RPS flat/1min). Gemeinsame Iterations-Logik liegt in `load-tests/lib/scenario-helpers.js`.
  2. Ein neues Node-Orchestrator-Script `scripts/local/run-spike.mjs` (analog zu `reset-seed.mjs`) fuehrt den Ablauf: `pnpm seed` mit `SALE_OPENS_IN_SECONDS` → Phase A als Kindprozess starten → `GET /api/tickets/:eventId/availability` alle 3s pollen → bei 3 aufeinanderfolgenden `available: 0`-Antworten `SIGINT` an den Phase-A-Prozess senden (k6s eingebauter graceful Stop) → Phase B starten.
  3. `pnpm spike` ruft direkt den Orchestrator auf.
- **Begruendung:**
  - k6s `ramping-arrival-rate`-Executor kennt nur zeitbasierte Stages; es gibt keinen eingebauten Mechanismus, eine Stage anhand einer Laufzeit-Bedingung (hier: Sold-Out) vorzeitig zu beenden. Ein externer Prozess, der den ohnehin vorhandenen Availability-Endpoint pollt und k6 per POSIX-Signal stoppt, ist der pragmatischste Weg, echte Reaktivitaet zu erreichen, ohne k6 selbst zu patchen oder auf den (fuer diesen Zweck ungeeigneten) `externally-controlled`-Executor auszuweichen, der nur VU-Anzahl, nicht Arrival-Rate steuert.
  - Drei aufeinanderfolgende Null-Polls statt eines einzelnen verhindern, dass ein kurzzeitiger Rueckgang (z. B. durch den periodischen Reconcile-Loop) faelschlich als Sold-Out interpretiert wird.
  - Das 15-Minuten-Sicherheitsnetz in Phase A stellt sicher, dass ein manueller `k6 run load-tests/spike-phase-a.js` (ohne Orchestrator) trotzdem terminiert.
  - Die Aufteilung in zwei Dateien mit gemeinsamen Helpers vermeidet Code-Duplikation und haelt jede Phase als eigenstaendig lauffaehiges k6-Script fuer manuelles Debugging nutzbar.
- **Alternativen:**
  - Einzelnes k6-Script mit grosszuegig bemessener fester "Sustain"-Dauer: kein neuer Code noetig, aber der Uebergang zu Cool-Down bleibt ein Timer-Ratespiel statt eines echten Signals — genau das Problem, das geloest werden sollte.
  - k6 `externally-controlled`-Executor mit externem Steuerprozess: technisch moeglich, aber der Executor ist auf VU-Skalierung ausgelegt, nicht auf Arrival-Rate, und ist in aktuellen k6-Versionen als Legacy markiert.
  - Kapazitaet lokal drastisch reduzieren (z. B. 5.000 statt 1.000.000 Tickets), um Sold-Out sicher in eine feste Zeitspanne zu zwingen: veraendert das Lastbild und die Realitaetsnaehe des Tests unnoetig; per Benutzerentscheidung wurde die Kapazitaet bei 1.000.000 belassen.
- **Umsetzung:**
  - `load-tests/lib/scenario-helpers.js`
  - `load-tests/spike-phase-a.js`
  - `load-tests/spike-phase-b.js`
  - `scripts/local/run-spike.mjs`
  - `scripts/local/reset-seed.mjs` (`SALE_OPENS_IN_SECONDS`)
  - `package.json` (`spike`-Skript)
  - `docs/ARCHITECTURE.md`, `docs/REQUIREMENTS.md`, `load-tests/README.md`

---

## ADR-026: Redis-Exporter + PostgreSQL-/Runtime-Bottleneck-Metriken

- **Status:** Fertig
- **Datum:** 2026-07-15
- **Kontext:** Baseline A (`docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md`) traf den Pub/Sub-Flow-Control-Deckel, bevor die Datenbank als Limiter nachweisbar war. Die Redis-Dashboards standen auf `No data`, weil kein `redis_exporter` deployt war, und es fehlten Signale zur belastbaren Engpass-Zuordnung (Pool-Saettigung, Query-Latenz, Lock-Kontention). Prozess-CPU und Event-Loop-Lag lagen bereits durch `prom-client`-Default-Metriken vor, waren aber in keinem Dashboard sichtbar.
- **Entscheidung:**
  1. `oliver006/redis_exporter` als Docker-Compose-Service (`hts-redis-exporter`, Host-Port `10009`, Container-Port `9121`) mit eigenem Prometheus-Scrape-Job (`job: redis`, container-intern per Service-Name). Aktiviert die bestehenden Redis-Performance-Panels.
  2. Worker-DB-Metriken via `prom-client`: `db_pool_connections{state}` (Gauge, auf jedem Scrape via `collect()` aus `pool.totalCount/idleCount/waitingCount` — `waiting` ist das Pool-Wait-Backpressure-Signal), `db_query_duration_seconds{query}` (Histogram) und `db_locks_waiting` (Gauge, per Intervall aus `pg_stat_activity` gesampelt).
  3. Query-Latenz wird am Kompositions-Wurzelpunkt (`defaultPubSubListenerRouteDeps`) via `timeDbQuery(name, fn)` gemessen, nicht durch Monkey-Patching von `pool.query`. `@repo/db` bleibt frei von Metrik-Kopplung; nur der Pool und ein `countWaitingLockBackends()`-Helper werden exportiert.
  4. Neues Dashboard „DB & Runtime“ (`monitoring/grafana/provisioning/dashboards/db-runtime.json`): Pool-Connections/-Wait, Query-Latenz (p50/p95/p99 + p95 je Query), Query-Durchsatz, Lock-Waits, Event-Loop-Lag (p99/mean) und Prozess-CPU fuer API und Worker.
- **Begruendung:**
  - Der `collect()`-Callback am Pool-Gauge kostet keine DB-Query — er liest nur In-Memory-Zaehler des Pools und ist damit scrape-guenstig. Lock-Waits kosten eine Query gegen `pg_stat_activity` und werden deshalb per Intervall (5 s, entspricht `scrape_interval`) statt pro Scrape gesampelt.
  - Timing am DI-Seam statt `pool.query`-Wrapper vermeidet fragile Overload-/Callback-Typprobleme und haelt die geteilte DB-Schicht rein; die drei relevanten Worker-Queries (`buy_ticket`, `list_event_inventory`, `mark_order_failed`) sind namentlich getrennt messbar.
  - `redis_exporter` ist der Standardweg fuer Redis-INFO-Metriken und liefert exakt die Serien-Namen, auf die die bestehenden Panels bereits verweisen.
- **Alternativen:**
  - `postgres_exporter` statt In-Worker-Metriken: liefert reichhaltige Server-Metriken, aber die pro-Query- und Pool-Wait-Sicht des Anwendungsprozesses (die fuer die #7-Analyse zaehlt) deckt er nicht ab; zusaetzlicher Container-Overhead.
  - `pool.query` global monkey-patchen: erfasst jede Query automatisch, aber mit hohem Typrisiko (node-postgres-Overloads inkl. Callback-Form) und Kopplung von `@repo/db` an die Worker-Registry.
  - CPU-/Event-Loop-Metriken neu instrumentieren: unnoetig, da `collectDefaultMetrics` sie bereits exponiert — es fehlte nur die Visualisierung.
- **Umsetzung:**
  - `docker-compose.yml` (`redis_exporter`-Service), `monitoring/prometheus.yml` (`job: redis`)
  - `packages/db/src/index.ts` (`pool`-Export), `packages/db/src/order-processing.ts` (`countWaitingLockBackends`)
  - `apps/worker/src/lib/metrics.ts` (`db_pool_connections`, `db_query_duration_seconds`, `db_locks_waiting`, `timeDbQuery`)
  - `apps/worker/src/plugins/db-metrics.ts` (Lock-Wait-Sampler mit onReady/onClose-Lifecycle)
  - `apps/worker/src/routes/pubsub-listener.ts` (Query-Timing an den DB-Deps)
  - `monitoring/grafana/provisioning/dashboards/db-runtime.json`
  - `docs/ARCHITECTURE.md`, `docs/REQUIREMENTS.md`

---

## ADR-027: Reservation-Ledger (ZSet) statt Keyspace-SCAN — Ablauf ≠ Rueckbuchung

- **Datum:** 2026-07-15
- **Kontext:** Baseline A (`docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md`) legte zwei Probleme im Reservation-Accounting offen:
  1. **Korrektheit (Oversell-Risiko):** Reservierungen lagen als per-`orderId`-Redis-Keys mit 120-s-TTL vor. Bei ~2.000 Accepts/s gegen ~500/s Worker-Drain wuchs die Queue-Latenz auf im Mittel ~406 s. Die 120-s-Keys liefen also ab, waehrend die zugehoerige Order noch unverarbeitet in Pub/Sub lag. Der Reconcile zaehlte die abgelaufene Reservierung nicht mehr (`available` blieb aber dekrementiert) → Drift fiel auf **-314k** → Reconcile buchte `available` positiv zurueck und machte damit noch beanspruchtes Inventar erneut verkaufbar. Waehrend eines laufenden Sales fuehrt das zu Ueberverkauf.
  2. **Skalierung:** `countActiveReservations` zaehlte per `SCAN MATCH tickets:event:{id}:reservation:*`. `SCAN` iteriert immer den gesamten Keyspace (nach 1 Mio. Verkaeufen ~2 Mio. Keys aus `orders:*` + `processed:*`) und filtert erst danach — pro Reconcile-Lauf zehntausende Roundtrips fuer eine Zahl, die >99 % der Keys nie betrifft.
- **Entscheidung:** Akzeptierte, noch nicht finalisierte Reservierungen werden in einem **Sorted Set pro Event** gefuehrt: `tickets:event:{eventId}:reservations`, Score = Erstellungszeit (Unix-ms, identisch mit `queuedAt`), Member = `orderId`.
  1. **Kein TTL.** Der Ledger-Eintrag ist ein Inventar-Anspruch, der ausschliesslich durch **Worker-Finalisierung (Erfolg)** oder **Kompensation (terminaler Fehler)** verschwindet — beide per `ZREM` im jeweiligen atomaren Script. Die frueheren per-`orderId`-Reservation-Keys mit TTL entfallen ersatzlos.
  2. **Zaehlung = `ZCARD`** (O(1)): Jeder Eintrag zaehlt als aktiver Anspruch, unabhaengig vom Alter. Warteschlangen-Latenz kann keine offene Reservierung mehr "ablaufen" lassen; die Drift bleibt bei ~0.
  3. **Ablauf ≠ Rueckbuchung.** Alter wird nur als **Stale-Signal** ausgewertet: `ZCOUNT reservations 0 (now − RESERVATION_STALE_SECONDS·1000)` liefert Reaper-Kandidaten als Gauge `reservation_ledger_stale`. Der Reconcile bucht auf Basis dieses Signals **nie** automatisch Inventar zurueck — die sichere Rueckgewinnung abgebrochener Ansprueche (Reaper + DLQ) ist ein eigenes Arbeitspaket in Phase 6.
  4. **Erfolgspfad entfernt den Anspruch aktiv:** `finalizeOrderProcessing` macht zusaetzlich zu Order-Cache + `processed`-Marker ein `ZREM`. Der Anspruch geht in `sold_count` ueber und darf nicht doppelt (als aktive Reservierung UND als Verkauf) zaehlen. `available` wird beim Erfolg **nicht** inkrementiert (das Ticket ist verkauft) — nur die Kompensation bucht `available` zurueck.
- **Begruendung:**
  - Der Kern der Baseline-A-Drift war nicht die SCAN-Dauer, sondern die **TTL-getriebene Freigabe** eines noch beanspruchten Inventars. Ein reines Umstellen von `SCAN`+`ZCOUNT <now> +inf` auf Score=Ablaufzeit haette den Bug reproduziert (abgelaufene Eintraege fielen aus der Zaehlung). Score=Erstellungszeit + `ZCARD` trennt "aktiver Anspruch" (Kardinalitaet) sauber von "verdaechtig alt" (Score-Range) — nur so ist Ablauf ein Signal statt einer stillen Freigabe.
  - `ZCARD` ist O(1), `ZCOUNT` O(log n) — beide unabhaengig von der Gesamtgroesse des Keyspace. Die 20.000-Roundtrip-Landmine des SCAN entfaellt.
  - Idempotenz bleibt gewahrt: `ZREM` liefert 1 nur beim ersten Entfernen; Rollback- und Kompensations-Script inkrementieren `available` genau dann. Gegen echtes `hts-redis` verifiziert.
- **Trade-off / bewusst offen:** Ohne Reaper (Phase 6) akkumulieren Ansprueche von Orders, die **nie** finalisiert werden (verlorene Nachricht, Poison Message), dauerhaft im Ledger und mindern `available` als Phantom-Claims (Undersell statt Oversell). Fuer die Baseline-B-Messung ist das akzeptabel (alle Orders drainen); die `reservation_ledger_stale`-Gauge macht den Effekt sichtbar, und der Reaper schliesst die Luecke spaeter. Die bewusste Wahl ist: **lieber voruebergehend undersell (sicher) als oversell (Vertragsbruch gegenueber dem Kunden).**
- **Alternativen (verworfen):**
  - **Stopgap `REDIS_RESERVATION_TTL_SECONDS` 120→900 s:** ~10 Minuten Aufwand, aber maskiert den Bug nur fuer Laeufe kuerzer als die TTL und laesst die SCAN-Landmine bestehen. Keine strukturelle Loesung.
  - **Score = Ablaufzeit + `ZCOUNT now +inf`:** effizient, reproduziert aber exakt das Oversell-Verhalten (Ablauf entfernt aus der Zaehlung).
  - **Reaper sofort mit-bauen:** groesserer Scope; die Korrektheit haengt nicht am Reaper, sondern am Wegfall der automatischen Rueckbuchung. Reaper bleibt Phase 6.
- **Umsetzung:**
  - `packages/types/src/redis-keys.ts` (`reservations`-ZSet, `reservation(orderId)` entfernt)
  - `packages/types/src/redis-client.ts` (`zcard`/`zcount`, `scan` entfernt)
  - `packages/env/src/index.ts` (`RESERVATION_STALE_SECONDS`, `REDIS_RESERVATION_TTL_SECONDS` entfernt)
  - `apps/api/src/lib/redis-scripts.ts` (Reserve: `ZADD`; Release: `ZREM`)
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/worker/src/lib/redis-scripts.ts` (Finalize: `ZREM`; Compensate: `ZREM`)
  - `apps/worker/src/lib/reconcile-ticket-availability.ts` (`ZCARD`/`ZCOUNT` statt SCAN, Stale-Messung)
  - `apps/worker/src/lib/metrics.ts` (`reservation_ledger_active`, `reservation_ledger_stale`)
  - `apps/worker/src/routes/pubsub-listener.ts` (Verdrahtung)
  - `docs/ARCHITECTURE.md`, `docs/TODO.md`
