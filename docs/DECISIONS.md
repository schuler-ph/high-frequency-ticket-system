# Architecture Decision Records

Dieser Index ist die Einstiegsebene. Lies für eine Aufgabe nur die verlinkten
ADRs, deren Entscheidung den betroffenen Bereich berührt. Neue Entscheidungen
erhalten eine eigene Datei unter `docs/decisions/`.

## Aktiv

- [ADR-001 Monorepo mit Turborepo](decisions/ADR-001-monorepo-mit-turborepo.md)
- [ADR-002 Fastify statt Express](decisions/ADR-002-fastify-statt-express.md)
- [ADR-003 Drizzle ORM statt Prisma](decisions/ADR-003-drizzle-orm-statt-prisma.md)
- [ADR-004 Asynchrone Writes über Pub/Sub](decisions/ADR-004-asynchrone-writes-uber-pub-sub.md)
- [ADR-005 Redis als Read-Cache](decisions/ADR-005-redis-als-read-cache.md)
- [ADR-007 GitHub Actions für CI/CD](decisions/ADR-007-github-actions-fur-ci-cd.md)
- [ADR-008 Zod für Schema Validation & DTOs](decisions/ADR-008-zod-fur-schema-validation-dtos.md)
- [ADR-009 Husky für Git Hooks](decisions/ADR-009-husky-fur-git-hooks.md)
- [ADR-011 Event Capacity Model vs. Pre-generated Tickets](decisions/ADR-011-event-capacity-model-vs-pre-generated-tickets.md)
- [ADR-012 Guest Checkout](decisions/ADR-012-guest-checkout-keine-authentifizierung.md)
- [ADR-013 Payment Flow Mocking](decisions/ADR-013-payment-flow-mocking.md)
- [ADR-015 Custom Error Classes & Secure Error Handling](decisions/ADR-015-custom-error-classes-secure-error-handling.md)
- [ADR-016 GCP-Ready Structured Logging mit Pino](decisions/ADR-016-gcp-ready-structured-logging-mit-pino.md)
- [ADR-017 Order-Status via Polling](decisions/ADR-017-order-status-via-polling-kein-sse.md)
- [ADR-018 Ticket-Kauf via SQL-Function im Worker](decisions/ADR-018-ticket-kauf-via-sql-function-im-worker.md)
- [ADR-020 Deterministische Tests & Debug-Guardrails](decisions/ADR-020-deterministische-tests-debug-guardrails.md)
- [ADR-021 Direkte Backend-Tests via `node:test`](decisions/ADR-021-direkte-backend-tests-via-node-test-und-native-typescript-quellen.md)
- [ADR-023 E2E-Observability](decisions/ADR-023-e2e-observability-queuedat-timestamp-latenz-histogramm-und-redis-db-drift.md)
- [ADR-024 Sale-Unlock-Gate](decisions/ADR-024-sale-unlock-gate-425-too-early.md)
- [ADR-025 Reaktive Sold-Out-Orchestrierung](decisions/ADR-025-reaktive-sold-out-orchestrierung-im-lokalen-lasttest.md)
- [ADR-026 Redis-Exporter und DB-/Runtime-Metriken](decisions/ADR-026-redis-exporter-postgresql-runtime-bottleneck-metriken.md)
- [ADR-027 Reservation-Ledger statt Keyspace-SCAN](decisions/ADR-027-reservation-ledger-zset-statt-keyspace-scan-ablauf-rueckbuchung.md)
- [ADR-028 Reserve→Pay→Publish-Split](decisions/ADR-028-reserve-pay-publish-split-payment-latenz-lebt-im-frontend.md)
- [ADR-029 Doku-Routing — TODO.md als Index](decisions/ADR-029-doku-routing-todo-md-ist-ein-index-kein-protokoll.md)
- [ADR-030 Automatisierter Grafana-Panel-Export](decisions/ADR-030-grafana-panel-export-als-png-grafana-image-renderer-statt-hand-screenshots.md)
- [ADR-031 Redis-authoritatives Inventory](decisions/ADR-031-redis-authoritatives-inventory-auditor-und-reaper-statt-schreibendem-reconcile.md)
- [ADR-032 Progressive Dokumentationsarchitektur](decisions/ADR-032-progressive-dokumentationsarchitektur.md)
- [ADR-033 Abgelaufener Checkout ist ein eigener Endzustand](decisions/ADR-033-abgelaufener-checkout-ist-ein-eigener-endzustand.md)
- [ADR-034 Ein Profil ist eine Datei — keine impliziten Defaults](decisions/ADR-034-ein-profil-ist-eine-datei-keine-impliziten-defaults.md)

## Teilweise umgesetzt

- [ADR-006 Prometheus + Grafana](decisions/ADR-006-prometheus-grafana-fur-monitoring.md)
- [ADR-019 TypeScript CLI via tsgo](decisions/ADR-019-typescript-cli-via-tsgo.md)

## Geplant

- [ADR-010 Terraform für Infrastructure as Code](decisions/ADR-010-terraform-fur-infrastructure-as-code-iac.md)
- [ADR-014 Wahl des Cloud Providers](decisions/ADR-014-wahl-des-cloud-providers-gcp-vs-eu-provider.md)

## Abgelöst

- [ADR-022 Periodischer Reconcile-Loop](decisions/ADR-022-periodischer-reconcile-loop-im-worker-singleton-deployment-strategie.md) durch ADR-031

Der Status ist eine Navigationserleichterung, kein Ersatz für `docs/TODO.md`.
ADR-Inhalte bleiben historisch stabil; ein Richtungswechsel erhält einen neuen
superseding ADR.

## ADR-Konvention

Dateiname:
`docs/decisions/ADR-<NNN>-<kurzer-kebab-case-titel>.md`.

Ein neuer ADR enthält mindestens:

```text
# ADR-NNN: Titel

- Status: Geplant | Teilweise umgesetzt | Fertig | Abgelöst
- Datum: YYYY-MM-DD
- Ersetzt: ADR-NNN (optional)

## Kontext
## Entscheidung
## Begründung
## Alternativen
## Konsequenzen
```

Der Index enthält nur Titel, Link und Navigationsstatus. Arbeitszuordnung
bleibt in `docs/TODO.md`. Kleine Präzisierungen erhalten einen datierten
Nachtrag im ADR; ein Richtungswechsel erhält einen neuen ADR, der den alten
explizit ablöst.
