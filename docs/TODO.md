# Implementation Roadmap: High-Frequency Ticket System

Die Phasen sind der rote Faden des Projekts und werden von oben nach unten
gelesen: oben abgeschlossen, unten offen. Eine neue Phase wird direkt nach der
aktuell aktiven Phase eingefügt, nie am Dateiende (siehe `AGENTS.md`).

## Phase 0: Planung & Entscheidungen

Abgeschlossen: Stack festgelegt (Node 20+, Fastify, Drizzle, PostgreSQL, Next.js + Tailwind, Prometheus/Grafana, GitHub Actions) und die Grunddokumente `docs/DECISIONS.md`, `docs/ARCHITECTURE.md` und `docs/REQUIREMENTS.md` angelegt.

ADRs: ADR-001 bis ADR-014 (Monorepo, Fastify, Drizzle, Pub/Sub-Writes, Redis-Reads, Prometheus/Grafana, CI, Zod, Husky, Terraform, Capacity-Modell, Guest Checkout, Payment-Mock, Cloud-Provider). → [Todos](notes/phases/phase-0-planning.md)

## Phase 1: Foundation & Tooling

Abgeschlossen: Turborepo mit pnpm, Fastify-Apps `api`/`worker`, `@repo/db`, `@repo/env` und `@repo/types` als Runtime-Pakete, Tailwind in `apps/web`, CI mit Cache und Node-Matrix (22 + 24), `tsgo`-Migration, direkter `node:test`-Pfad, `debug:*`-Skripte und Runbook-Diagnosen.

ADRs: ADR-019 (tsgo), ADR-020 (deterministische Tests & Debug-Guardrails), ADR-021 (Backend-Tests via `node:test`). → [Todos](notes/phases/phase-1-foundation-tooling.md) · [Runbook §8](RUNBOOK.md#8-debugging)

## Phase 2: Data Layer & Infrastructure (Local)

Abgeschlossen: `docker-compose.yml` fuer PostgreSQL, Redis und Pub/Sub-Emulator, Reset-/Seed-Skript, Drizzle in `packages/db` mit Schema fuer `tickets`/`orders` und erster Migration, `BuyTicketRequest`-DTO in `packages/types`.

ADRs: ADR-003 (Drizzle), ADR-008 (Zod-DTOs), ADR-011 (Event-Capacity-Modell). → [Todos](notes/phases/phase-2-data-layer.md)

## Phase 3: Core Logic (Backend)

Abgeschlossen: Fastify-API mit Zod-Type-Provider, Healthcheck, Redis- und Pub/Sub-Plugins, Availability-Route aus Redis und `POST /buy` mit 202/409; Worker mit Pull-Subscription, `buy_ticket(...)`-SQL-Function und ACK/NACK-Regeln.

ADRs: ADR-015 (typed Errors), ADR-016 (strukturiertes Logging), ADR-018 (Ticket-Kauf via SQL-Function). → [Todos](notes/phases/phase-3-core-logic.md)

## Phase 3.1: Flow Hardening (Korrektheit + Performance)

Abgeschlossen: event-spezifische Redis-Keys, atomare Reservierung mit Publish-Rollback, idempotenter Worker mit Kompensation, `orders`-Modell mit Redis-materialisiertem Status fuer `GET /api/orders/:orderId`, Reconcile-Loop, Flow-Metriken und CI-Guardrails.

ADRs: ADR-017 (Order-Status via Polling), ADR-022 (Reconcile-Loop, abgeloest durch ADR-031), ADR-023 (E2E-Observability). → [Todos](notes/phases/phase-3-1-flow-hardening.md)

## Phase 4: Interface & Testing

Abgeschlossen: Next.js-Landingpage mit Verfuegbarkeit, Kaufen-Button und Feedback; k6-Spike mit reaktiver Sold-Out-Erkennung, Baseline A, Sale-Unlock-Gate und die Evidence-/Report-Pipeline.

ADRs: ADR-024 (Sale-Unlock-Gate 425), ADR-025 (reaktive Sold-Out-Orchestrierung). → [Todos](notes/phases/phase-4-load-tests.md) · [Baseline A](reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md) · `scripts/load-test/README.md`

## Phase 4.1: Monitoring & Observability

Abgeschlossen: `prom-client` und `/metrics` in API und Worker, Prometheus/Grafana im Compose, acht Dashboards (API, Order Lifecycle, Completion Latency, Redis, Pub/Sub, Worker Reliability, Reservation & Consistency, DB & Runtime), PromQL gegen fehlende Zero-Serien gehaertet.

ADRs: ADR-023 (Nachtrag E2E-Buckets/Throughput), ADR-026 (redis_exporter + DB-/Runtime-Metriken). → [Todos](notes/phases/phase-4-1-observability.md)

## Phase 4.2: Standard-Flow-Optimierung (vgl. `docs/reports/ANALYSIS-STANDARD-FLOW.md`)

Abgeschlossen: Massnahmen #1–#6, #8, #10 der Standard-Flow-Analyse — atomare Lua-Scripts fuer Reserve und Worker-Finalisierung, Delta-Reconcile, Outcome-Policy im Listener, `processing`-Lock gestrichen, Reservation-Ledger (ZSet) statt Keyspace-SCAN.

ADRs: ADR-027 (Reservation-Ledger), Updates zu ADR-004/ADR-005. → [Todos](notes/phases/phase-4-2-standard-flow.md) · [Analyse](reports/ANALYSIS-STANDARD-FLOW.md)

## Phase 4.3: Checkout & Payment-Simulation (Web + API)

Abgeschlossen: Reserve/Pay-Split — `/buy` reserviert nur, `/pay` publiziert synchron, `/cancel` gibt frei; Worker-Sleep entfernt, die Payment-Latenz lebt als 3DS-Simulation im Frontend (Payment-Modal, `tracking`-Phase, Live-Order-Status).

ADRs: ADR-028 (Reserve→Pay→Publish-Split), Annotationen an ADR-013/ADR-023. → [Todos](notes/phases/phase-4-3-checkout.md)

- [x] **Checkout ohne Modal (2026-09-06):** Zahlungsformular inline, rechts Zusammenfassung mit Name (aus `GET /orders/:orderId`), voller Bestellnummer und Deadline; „Testdaten“-Hinweis entfernt.

## Phase 4.4: Weg zur Baseline B (Folgearbeit aus Phase 4–4.2)

Abgeschlossen: `sold_count`-Hot-Row entfernt (Migration 0009, ~112× im Micro-Bench), Pre-Baseline-Cleanups (k6-Checkout-Funnel, Abandonment/Think-Time, Fehler-Schemas), `start:loadtest`, Report-Automation-MVP und Baseline B (benchmark-invalid, fachlich korrekt).

ADRs: ADR-011 (Capacity-Modell ohne Hot-Row), ADR-024, ADR-025. → [Todos](notes/phases/phase-4-4-baseline-b-path.md) · [stage-2](notes/backlogs/stage-2-db-hot-row.md) · [stage-3](notes/backlogs/stage-3-pre-baseline-cleanups.md) · [stage-4](notes/backlogs/stage-4-capacity-evidence.md)

## Phase 4.5: Baseline-B-Nachlauf (entdeckt 2026-07-26)

Abgeschlossen: Messkette repariert (Drain-Formel auf Publish, redelivery-tolerante Finalisierung, `resolveCounter`), k6-Remote-Write opt-in, `service_config_info`, Plateau-Detektor unterscheidet `sold-out`/`stalled`; Baseline C und Storage-Review nach 4.12 bzw. 6 verschoben.

ADRs: ADR-025 (Nachtrag Plateau-Klassifikation). → [Todos](notes/phases/phase-4-5-baseline-b-followup.md) · [Vorspann](notes/backlogs/baseline-b-overview.md) · [Baseline B](reports/baseline-b-2026-07-26/LOAD-TEST-REPORT-2026-07-26.md)

## Phase 4.6: Baseline-C-Nachlauf (entdeckt 2026-07-26 abends)

Abgeschlossen: Reconcile-Leseordnung Ledger-vor-DB, Drift-Gauge entklammert, `DATABASE_POOL_MAX` 50 und `maxVUs` 10.000, Dashboard-Audit aller acht Dashboards (Leitfehler: Reserve als Publish gelesen; elf Panel-Korrekturen).

ADRs: ADR-022 (Nachtrag Leseordnung). → [Todos](notes/phases/phase-4-6-baseline-c-followup.md) · [Baseline C](reports/baseline-c-2026-07-26/LOAD-TEST-REPORT-2026-07-26.md) · [Dashboard-Audit](notes/backlogs/baseline-c-dashboard-audit.md)

## Phase 4.7: API-Performance-Dashboard — fehlende Order-Routen

Abgeschlossen im Dashboard-Audit des Baseline-C-Nachlaufs: `/pay`- und `/cancel`-RPS-Serien und ein `POST /pay`-Latenzpanel im API-Performance-Dashboard; bewusst kein eigenes `/cancel`-Latenzpanel.

ADRs: keine neue; Kontext ADR-028. → [Todos](notes/phases/phase-4-7-api-performance.md)

## Phase 4.8: Belegerhebung & Entwickler-Werkzeug (entdeckt 2026-07-27)

Kleinteilige Verbesserungen am Lasttest-Werkzeug, die beim Fahren der Baseline-D-Vorbereitung aufgefallen sind.

- [x] **Grafana-Panels als PNG exportieren:** alle 48 Panels reproduzierbar im Run-Verzeichnis. → ADR-030, [RUNBOOK §5](RUNBOOK.md#5-auswertung-braucht-keinen-laufenden-stack)
- [x] **Web im Lasttest-Stack mitstarten:** der `LT Stack`-Button liess das Frontend aus, obwohl es zum Beobachten laeuft; neuer Task `loadtest:web` (Dev-Modus, :10001), `loadtest:stack down` raeumt den Port mit auf. → [RUNBOOK §3](RUNBOOK.md#3-lasttest-stack-hochfahren-gebauter-stand)

## Phase 4.9: Redis-authoritatives Inventory

Ziel: Redis-Inventar wird nur durch atomare Reserve-/Release-/Finalize-Skripte verändert. Reconcile wird durch Audit, Projektion und sichere Freigabe ersetzt. → ADR-031, [Plan](notes/phases/phase-4-9-inventory-integrity.md)

- [x] **Alle neun Punkte umgesetzt (2026-07-30):** Capacity-Invariante, Auditor, Projector, Reconcile entfernt, Reaper, Dashboards. → [Einzelpunkte](notes/phases/phase-4-9-inventory-integrity.md), [Beleg](reports/grafana-panels-2026-08-03/PANEL-GUIDE-2026-08-03.md)

## Phase 4.10: Checkout-Expiry-Funnel (entdeckt 2026-08-14)

Abgeschlossen: `expiresAt` im Vertrag, `expired`-Grabstein statt `DEL` mit Deadline-Enforcement in `claimPayment`, Checkout-Route mit Countdown, k6-Profil mit Profiltabelle, Reaper-Dimensionierung, Funnel-Panels und Funnel-Lauf (`browse-and-buy-human-pace`, 100k).

ADRs: ADR-033 (abgelaufener Checkout als Endzustand), ADR-034 (ein Profil ist eine Datei), ADR-035. → [Plan + Todos](notes/phases/phase-4-10-checkout-expiry.md) · [Gedanken-Notiz](notes/backlogs/checkout-expiry-funnel.md)

## Phase 4.11: Report-Automation cloud-faehig machen (Vorbedingung fuer den GCP-Lasttest)

- [x] ~~Snapshots, Preflight, Seed-Pfad, verteilter k6-Runner, Monitoring-Quelle.~~ **Aufgeloest 2026-08-18:** die fuenf Todos leben in Phase 5.3, 5.5 und 5.7 weiter. → [Details](notes/backlogs/cloud-report-automation.md#backlog-report-automation-cloud-faehig-vorspann)

## Phase 4.12: Lokale Baseline C mit getrenntem Lastgenerator (Zwei-Maschinen-Setup)

Abgeschlossen: Zwei-Maschinen-Setup (k6 auf dem Ryzen-PC via ssh-Spawn, SUT auf dem MacBook), Lauf mit getrenntem Generator 2026-08-17 (`degraded`, ~8k it/s, echter Sellout), Transportfehler nach Endpunkt, Profile 4 → 3 konsolidiert, k6-Kardinalitaet begrenzt.

ADRs: ADR-035 (Profile nach Szenario). → [Todos](notes/phases/phase-4-12-local-generator-split.md) · [Vorspann](notes/backlogs/local-generator-split.md) · [Report](reports/baseline-d-2026-08-17/LOAD-TEST-REPORT-2026-08-17.md) · [RUNBOOK §3](RUNBOOK.md#zwei-maschinen-setup-generator-getrennt-vom-sut)

## Phase 4.13: Baseline F — gueltiger Lauf je Profil

Abgeschlossen: Harness und System vorbereitet (Lastform als Profilwerte, komprimierte Zeit, Buckets, Lock-Waits, Pool-Timeout, Index); Baseline F 2026-08-26 mit `system: pass`, `performance: pass`, exaktem Sellout und `benchmark: degraded` (API-Core-Decke ~9k it/s). Referenz fuer 5.6.

ADRs: ADR-036 (Performance als drittes Verdict), ADR-037 (Pending-Reaper in eigenem Takt). → [Todos](notes/phases/phase-4-13-baseline-f.md) · [Vorspann](notes/backlogs/baseline-f-valid-runs.md#baseline-f-vorspann) · [Report](reports/baseline-f-2026-08-26/LOAD-TEST-REPORT-2026-08-26.md)

## Phase 5: Cloud Deployment (GCP)

Roter Faden: erst lokal beweisen (5.1–5.3), dann Cloud (5.4–5.7); Cloud-Arbeit
erst nach gemeinsamer GCP-Einarbeitung. Anforderungen: REQ-D01–D06. → [Details](notes/phases/phase-5-cloud-deployment.md)

### Wichtige Dokumente

- Lernüberblick → [Der Sprung nach GKE](https://claude.ai/code/artifact/db918407-944b-40a2-b9e7-42f4b1d05de5)
- Selbstlernkurs für Phase 5.1 - 5.7 → [GKE-Werkstatt](https://claude.ai/code/artifact/7b9a13ca-f581-4075-819c-690f996e019a)
- Überblick über die nächsten Phasen [HTS Standortbestimmung](/Users/p.schuler/repos/privat/hts-standortbestimmung-2026-08-26.md)

### Phase 5.1 — Containerisierung und lokales Kubernetes

- [x] **Web von Next.js auf Vite-SPA umgestellt (2026-08-27):** statisches `dist/`, kein Node zur Laufzeit; Vorarbeit fuer das Web-Dockerfile (nginx + `index.html`-Fallback). → ADR-039
- [x] **Env-Profile nach `packages/env/profiles/` verschoben (2026-09-07):** Loader loest `../profiles/` auf; `pnpm deploy` bringt sie ins Image, die `COPY`-Zeile im API-Dockerfile entfaellt. → ADR-041
- [ ] **Dockerfiles fuer API, Worker, Web:** Runtime-Pfad `dist`, Build in GitHub Actions. → ADR-019, ADR-007
- [ ] **Manifeste gegen lokalen Cluster, 1 Replica:** Datenstores bleiben Compose. Werkzeuge kubectl + kind → ADR-038; lokale Vorstufe → ADR-010-Nachtrag (erledigt); `k8s/` in DOCS.md routen.


### Phase 5.2 — Multi-Replica-Korrektheit lokal

- [ ] **N API-Replicas hinter Ingress:** Korrektheit statt Kapazitaet (REQ-D02).
- [ ] **Entscheidung Zeitquellen bei Replicas:** Sale-Unlock (ADR-024) und Checkout-Deadline (ADR-033) gemeinsam entscheiden; Drift-Nachweis erst in 5.6.
- [ ] **Entscheidung Instanzzahl je Komponente** (REQ-D02; Worker: ADR-004/ADR-031); Graceful Shutdown aus Phase 6 als Vorbedingung fuer Rolling Updates.

### Phase 5.3 — Messkette umgebungsunabhaengig

- [ ] **Zugriffspfade abstrahieren** (Snapshots, Preflight, Reset/Seed, TSDB-Wipe, Sold-out-Quelle ADR-025); eigener ADR.
- [ ] **Aggregation bei N Instanzen fixen:** `targetUp`/Erst-Serie-Queries, `sum()` ueber replizierte Gauges (REQ-D04).
- [ ] **Smoke-Profil `browse-and-buy-smoke` abnehmen:** 1k Tickets, sofort offen, alles zahlt, ~3 min — zaehlt die Messkette richtig (alle Zaehler exakt 1 000)? Erst lokal, dann in jeder Cloud-Stufe. Lauf nur mit Freigabe. → ADR-035 Nachtrag

### Phase 5.4 — Cloud-Fundament

- [ ] **IaC fuer Netz, DB, Cache, Cluster, Queue, Registry, Secrets;** Manifeste via Kubeconfig. → Entscheidungsmatrix in der Details-Notiz (ADR-003/005/010/031/034)
- [ ] **Smoke:** ein E2E-Kauf in der Cloud, danach vollstaendiger Abbau (REQ-D01).

### Phase 5.5 — Cloud-Monitoring

- [ ] **Entscheidung Monitoring-Quelle:** neuer ADR; ADR-006 bleibt fuer lokal gueltig (Nachtrag). Grafana + Renderer gehoeren zur Evidenz (ADR-030, REQ-O04).

### Phase 5.6 — Cloud-Baseline auf Paritaetsniveau

- [ ] **`spike:report` in der Cloud mit dem Referenzprofil** (REQ-P01), Vergleich gegen [Baseline F](reports/baseline-f-2026-08-26/LOAD-TEST-REPORT-2026-08-26.md) — Runde 1, 9 009 it/s, p95 228 ms, ein API-Core (REQ-D03, REQ-D05 Stufe 1). Lauf nur mit Freigabe.

### Phase 5.7 — Cloud-Zielprofil

- [ ] **Verteilter Generator** inkl. Quantil-Merge der Teil-Summaries; Kapazitaet fuer den 50k-Lauf entscheiden (REQ-P02). Haengt an Phase 4.13. Lauf nur mit Freigabe.

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
- [x] Schließe die letzte Ausnahme in `apps/web` (`check-types`) auf `tsgo` — erledigt 2026-08-27 mit dem Vite-Wechsel (ADR-039): kein `next typegen` mehr, `tsgo --noEmit` kompiliert `apps/web` inklusive CSS-Import.
- [ ] Migriere Dev-Watch-Restart-Flow von `tsc-watch` auf einen `tsgo`-basierten Restart-Workflow (API + Worker).
