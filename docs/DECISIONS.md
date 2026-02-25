# Architecture Decision Records (ADR)

Jede Architekturentscheidung wird hier als ADR dokumentiert. Das erlaubt es, den Kontext und die Begründung jeder Entscheidung nachzuvollziehen – sowohl für Teammitglieder als auch für KI-Agenten, die am Projekt arbeiten.

---

## ADR-001: Monorepo mit Turborepo

- **Status:** Accepted
- **Datum:** 2026-02-24
- **Kontext:** Einzelnes Showcase-Projekt mit Frontend, API, Worker und shared Packages. Recruiter und Reviewer sollen alles in einem Repository sehen können.
- **Entscheidung:** Turborepo mit pnpm Workspaces.
- **Begründung:** Einfacher als Nx für diesen Scope. Exzellentes Build-Caching. Nativer Support für pnpm. Klare Workspace-Struktur (`apps/*`, `packages/*`).
- **Alternativen:** Nx (zu komplex für Scope), separate Repositories (fragmentiert Portfolio).

---

## ADR-002: Fastify statt Express

- **Status:** Accepted
- **Datum:** 2026-02-24
- **Kontext:** High-Concurrency API benötigt maximale Performance bei I/O-bound Workloads. Das System muss unter extremer Last (50.000+ gleichzeitige Nutzer) stabil bleiben.
- **Entscheidung:** Fastify als HTTP-Framework für API Gateway und Worker.
- **Begründung:** ~2x schneller als Express in Benchmarks. Schema-basierte Serialisierung reduziert Overhead. Native TypeScript-Unterstützung. Plugin-Architektur passt zu Microservice-Pattern.
- **Alternativen:** Express (langsamer, legacy patterns), Hono (weniger Ecosystem-Support für Node.js).

---

## ADR-003: Drizzle ORM statt Prisma

- **Status:** Accepted
- **Datum:** 2026-02-24
- **Kontext:** ORM muss typsicher sein, nah an SQL bleiben und minimalen Runtime-Overhead erzeugen. Späterer Wechsel zu Cloud Spanner muss möglich sein.
- **Entscheidung:** Drizzle ORM (Code-First).
- **Begründung:** Typen werden direkt aus dem Schema inferiert (`$inferSelect`, `$inferInsert`). Kein Code-Generator nötig. SQL-nah = einfacherer Wechsel zu Cloud Spanner. Leichtgewichtiger als Prisma (kein Rust-basierter Engine-Binary).
- **Alternativen:** Prisma (schwerer, generierter Client), Kysely (kein Migration-Tooling).

---

## ADR-004: Asynchrone Writes über Pub/Sub

- **Status:** Accepted
- **Datum:** 2026-02-24
- **Kontext:** Bei Lastspitzen (Ticket-Sale-Start) würden direkte DB-Schreibzugriffe die PostgreSQL-Instanz überlasten. Die API muss sofort antworten können, unabhängig von der DB-Kapazität.
- **Entscheidung:** API published Kauf-Intents in Google Cloud Pub/Sub, Worker konsumiert und schreibt in DB.
- **Begründung:** Entkopplung von Spike-Traffic und DB-Write-Kapazität. API kann sofort HTTP 202 (Accepted) antworten. Pub/Sub garantiert At-Least-Once Delivery. Worker kann unabhängig skaliert werden.
- **Alternativen:** Direktes DB-Write mit Connection Pooling (skaliert nicht ausreichend), Redis Streams (weniger Feature-reich als Pub/Sub).

---

## ADR-005: Redis als Read-Cache

- **Status:** Accepted
- **Datum:** 2026-02-24
- **Kontext:** Die API muss Ticket-Verfügbarkeiten in Sub-Millisekunden-Bereich liefern. Direkte DB-Reads unter Last sind zu langsam und überlasten PostgreSQL.
- **Entscheidung:** Cloud Memorystore (Redis) als exklusive Read-Quelle für die API. Worker aktualisiert den Cache nach erfolgreichen DB-Writes.
- **Begründung:** Redis liefert konsistente Reads im Mikrosekunden-Bereich. Atomic Decrement (`DECR`) verhindert Overselling. Eventual Consistency ist akzeptabel für Verfügbarkeitsanzeige.
- **Alternativen:** DB-Read-Replicas (teurer, höhere Latenz), Application-Level Cache (nicht cluster-fähig).

---

## ADR-006: Prometheus + Grafana für Monitoring

- **Status:** Accepted
- **Datum:** 2026-02-24
- **Kontext:** Lasttest-Ergebnisse müssen visuell dokumentiert werden für das GitHub README. Das System muss unter Last beobachtbar sein. Lokales Development braucht ein kostenloses, leichtgewichtiges Setup.
- **Entscheidung:** Prometheus für Metrics Collection (via `prom-client` in Fastify), Grafana für Dashboards. Lokal via Docker Compose. k6 exportiert direkt an Prometheus → Live-Visualisierung in Grafana.
- **Begründung:** Offener Standard, kostenlos, riesiges Ecosystem. k6 hat native Prometheus-Integration. Grafana-Dashboards können als JSON exportiert und im Repo versioniert werden. OpenTelemetry wurde bewusst weggelassen – Prometheus + Grafana decken den Scope (Metriken + Dashboards) vollständig ab. OTel wäre nur für Distributed Tracing über viele Services relevant, was hier Overkill ist.
- **Alternativen:** Cloud Monitoring (kostet Geld, nur in GCP), Datadog (proprietär, teuer), OpenTelemetry (zu komplex für den Scope).

---

## ADR-007: GitHub Actions für CI/CD

- **Status:** Accepted
- **Datum:** 2026-02-24
- **Kontext:** Automatisierte Quality Gates (lint, typecheck, build) sind notwendig, um Code-Qualität im Monorepo sicherzustellen.
- **Entscheidung:** GitHub Actions mit Turborepo-Cache für lint, typecheck und build.
- **Begründung:** Native GitHub-Integration. Kostenlose Minuten für Open-Source-Repos. Turborepo-Cache beschleunigt CI-Runs erheblich.
- **Alternativen:** GitLab CI (anderer Hoster), Cloud Build (GCP-only Lock-in).

---

## ADR-008: Zod für Schema Validation & DTOs

- **Status:** Accepted
- **Datum:** 2026-02-24
- **Kontext:** Request-Validation muss typsicher sein und darf keine doppelten Typ-Deklarationen erzeugen. Fastify nutzt JSON Schema für Serialisierung.
- **Entscheidung:** Zod-Schemas als Single Source of Truth für Request/Response-Typen. TypeScript-Typen werden via `z.infer<>` abgeleitet.
- **Begründung:** Zod ist der De-facto-Standard für Runtime-Validation in TypeScript. Integration mit Fastify via `zod-to-json-schema`. Keine manuellen Typ-Duplikate.
- **Alternativen:** Ajv + manuelle Typen (fehleranfällig), TypeBox (weniger verbreitet).

---

## ADR-009: Husky für Git Hooks

- **Status:** Accepted
- **Datum:** 2026-02-24
- **Kontext:** Code-Qualität soll lokal vor Commit/Push sichergestellt werden, ohne dass Entwickler manuell Befehle ausführen müssen. CI soll nicht der erste Ort sein, an dem Fehler auffallen.
- **Entscheidung:** Husky mit zwei Hooks: `pre-commit` (format), `pre-push` (lint + typecheck). Build läuft nur in der CI-Pipeline.
- **Begründung:** Format beim Commit hält Diffs sauber. Lint + Typecheck beim Push verhindert kaputte Pushes. Build nur in CI, um lokale Wartezeiten kurz zu halten. Turbo-Cache macht wiederholte Runs fast instant.
- **Alternativen:** lefthook (weniger verbreitet), simple-git-hooks (weniger Features), nur CI (Feedback-Loop zu lang).

---

## ADR-010: Terraform für Infrastructure as Code (IaC)

- **Status:** Accepted
- **Datum:** 2026-02-25
- **Kontext:** Das Projekt soll realistisch in der Google Cloud (GKE, Cloud SQL, Memorystore, Pub/Sub) laufen. Für das Portfolio und die Reproduzierbarkeit muss das Infrastruktur-Setup code-basiert, versioniert und wiederholbar sein.
- **Entscheidung:** Terraform für das gesamte Cloud-Ressourcen-Management. Kubernetes-Manifeste werden über klassische YAML-Dateien (oder Helm) via Kubeconfig angewendet, nachdem Terraform den GKE Cluster provisioniert hat.
- **Begründung:** Terraform ist der unangefochtene Industrie-Standard für Cloud-agnostische, aber Cloud-native Infrastruktur. Es ermöglicht ein sauberes Setup von VPCs, IAM und den gemanagten Services (Cloud SQL, Redis, Pub/Sub).
- **Alternativen:**
  - _Google Cloud Deployment Manager:_ Veraltet, wird kaum noch genutzt.
  - _Pulumi:_ Moderner (TypeScript), aber Terraform ist aktuell noch der de-facto Standard, den Recruiter/Seniors bevorzugen.
  - _ClickOps (GCP Console):_ Nicht reproduzierbar, keine Versionierung (absolutes No-Go für ein Showcase-Projekt).
