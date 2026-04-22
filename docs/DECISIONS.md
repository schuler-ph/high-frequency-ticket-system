# Architecture Decision Records (ADR)

Jede Architekturentscheidung wird hier als ADR dokumentiert. Das erlaubt es, den Kontext und die Begründung jeder Entscheidung nachzuvollziehen – sowohl für Teammitglieder als auch für KI-Agenten, die am Projekt arbeiten.

## ADR Status & TODO-Mapping

Dieses Kapitel verknüpft jede ADR mit dem aktuellen Umsetzungsstatus und der Stelle in `docs/TODO.md`, in der die Umsetzung erledigt wurde oder geplant ist.

| ADR                                                     | Status           | TODO-Abbildung                                                                                                  |
| ------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| ADR-001 Monorepo mit Turborepo                          | Fertig           | Phase 1 (Foundation & Tooling) erledigt                                                                         |
| ADR-002 Fastify statt Express                           | Fertig           | Phase 3 (Core Logic) API + Worker Setup erledigt                                                                |
| ADR-003 Drizzle ORM statt Prisma                        | Fertig           | Phase 2 (Data Layer) Drizzle Setup + Migration erledigt                                                         |
| ADR-004 Asynchrone Writes über Pub/Sub                  | Teilweise fertig | Phase 3 Buy-Flow erledigt; ACK/NACK-Regeln dokumentiert und getestet; weitere Härtung in Phase 3.5 geplant      |
| ADR-005 Redis als Read-Cache                            | Teilweise fertig | Phase 3 Availability-Read erledigt; event-spezifische Keys + Reconcile in Phase 3.5 geplant                     |
| ADR-006 Prometheus + Grafana                            | Geplant          | Phase 4.5 (Monitoring & Observability)                                                                          |
| ADR-007 GitHub Actions für CI/CD                        | Fertig           | Phase 1 (`.github/workflows/ci.yml`) erledigt                                                                   |
| ADR-008 Zod für Validation & DTOs                       | Fertig           | Phase 2 DTOs + Phase 3 Route-Schemas erledigt; DTO-Vertrag für Tests dokumentiert                               |
| ADR-009 Husky für Git Hooks                             | Fertig           | Bereits umgesetzt (außerhalb der Phasenliste, als Standard-Tooling aktiv)                                       |
| ADR-010 Terraform für IaC                               | Geplant          | Phase 5 (Cloud Deployment)                                                                                      |
| ADR-011 Capacity Model vs. Pre-generated Tickets        | Teilweise fertig | Phase 2/3 Grundmodell erledigt; End-to-End-Korrektheit in Phase 3.5 geplant                                     |
| ADR-012 Guest Checkout                                  | Fertig           | Phase 3 Buy-Request ohne Auth umgesetzt                                                                         |
| ADR-013 Payment Flow Mocking                            | Geplant          | Phase 3 Worker-Latenz als Aufgabe vorgesehen, final aktivieren in Phase 3.5                                     |
| ADR-014 Cloud Provider GCP                              | Geplant          | Phase 5 (GCP Terraform + Deployment)                                                                            |
| ADR-015 Custom Error Classes & Secure Error Handling    | Fertig           | Phase 3 Error Handler und typed errors umgesetzt                                                                |
| ADR-016 GCP-ready Structured Logging mit Pino           | Fertig           | API/Worker Logger-Konfiguration umgesetzt                                                                       |
| ADR-017 Order-Status via Polling                        | Geplant          | Phase 3.5 Orders↔Tickets Verknüpfung + später Phase 4 Frontend-Polling                                          |
| ADR-018 Ticket-Kauf via SQL-Function im Worker          | Fertig           | Phase 3 Worker nutzt `buy_ticket(...)`                                                                          |
| ADR-019 TypeScript CLI via tsgo                         | Teilweise fertig | Phase 1 Tooling: `tsc` in Build/Test/Typecheck weitgehend migriert; Ausnahmen Web-Checktypes + Dev-Watch folgen |
| ADR-020 Deterministische Tests & Debug-Guardrails       | Fertig           | Phase 1 Tooling: feste Test-Entrypoints, Debug-Skripte, Runbook und CI-Guardrails umgesetzt                     |
| ADR-021 Direkte Backend-Tests via node:test + native TS | Fertig           | Phase 1 Tooling: API/Worker/DB Tests laufen paketlokal ohne Shared Runner, Vitest oder tsx im Test-Hot-Path     |

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
- **Begruendung:** Polling ist einfach, robust und passt zur entkoppelten Architektur. Der Worker schreibt den finalen Status in die Datenbank (und optional in Redis) und die API liest den Status fuer den Client. Kein direkter Worker-Client-Kanal, keine zusaetzliche Persistenz fuer SSE-Verbindungszustand.
- **Alternativen:**
  - **Server-Sent Events:** wuerde einen dauerhaften API-Client-Kanal erfordern und zusaetzliche Infrastruktur/State-Management (Reconnect, Lastverteilung) benoetigen.
  - **WebSockets:** aehnlich wie SSE, aber komplexer im Betrieb, besonders unter Lastspitzen.
  - **Kein Status-Feedback:** schlechter UX und fuer das Demo-Szenario unzureichend.

### Update 2026-04-22: Sofort beobachtbarer Pending-Status nach `202 Accepted`

- **Kontext:** Zwischen `POST /api/tickets/:eventId/buy` und der spaeteren Worker-Persistenz existierte eine Luecke: Direkt nach `202 Accepted` war der Auftrag fuer einen geplanten `GET /api/orders/:orderId` noch nicht konsistent lesbar, weil die API keine DB schreiben darf und die Order erst im Worker entsteht.
- **Entscheidung:** Die API schreibt nach erfolgreicher Redis-Reservation einen temporaeren Pending-Status pro `orderId` in Redis (`orders:{orderId}:pending`) mit eigener, laengerer TTL. Bei Publish-Fehlern bleibt das kritische Inventory-Rollback (`reservation` loeschen + `available` kompensieren) garantiert; Pending-Cleanup ist nachgelagert und darf dieses Rollback nicht blockieren.
- **Begruendung:** So bleibt der Buy-Flow DB-write-frei, waehrend der spaetere Order-Read-Pfad unmittelbar nach `202 Accepted` einen stabileren Pending-Fallback nutzen kann, auch wenn Queue-Backlog laenger als die Reservation lebt. Gleichzeitig fuehrt ein Fehler beim Pending-Cleanup nicht dazu, dass Inventory-Rollback ausfaellt.
- **Umsetzung:**
  - `packages/types/src/redis-keys.ts`
  - `packages/types/src/tickets.ts`
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/api/test/routes/tickets.buy.test.ts`

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
