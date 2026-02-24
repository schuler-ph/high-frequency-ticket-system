# Project Requirements: High-Frequency Ticket System

## Core Objective

Entwicklung eines hochskalierbaren, asynchronen Ticket-Buchungssystems zur Simulation extremer Lastspitzen (Event: Frequency Festival 20XX Tickets). Fokus liegt auf der Vermeidung von Datenbank-Überlastungen durch Caching und Message-Queuing.

## Event-Theme

- **Event:** Frequency Festival 20XX
- **Location:** St. Pölten, Österreich
- **Ticket-Typ:** General Admission Tickets
- **Ticket-Pool:** 1.000.000 Tickets
- **Szenario:** Realistischer Verkaufsstart mit steigender Last. Nutzer strömen vor Verkaufsstart auf die Seite (Warm-Up), beim Opening explodiert der Traffic, Tickets werden verkauft bis Sold-Out, danach fällt der Traffic ab.

## Tech Stack & Architecture

- **Repository Strategy:** Monorepo (Turborepo)
- **Package Manager:** pnpm (v10+)
- **Language:** TypeScript (Fullstack, 100%)
- **Frontend:** Next.js, Tailwind CSS
- **Backend Runtime:** Node.js (v20+)
- **Backend Framework:** Fastify (API Gateway & Worker Services)
- **Database:** PostgreSQL (Cloud SQL, architected for future Cloud Spanner migration)
- **ORM:** Drizzle ORM (Code-First)
- **Schema Validation & DTOs:** Zod
- **Message Broker:** Google Cloud Pub/Sub
- **Caching:** Cloud Memorystore (Redis)
- **Infrastructure as Code:** Terraform
- **Deployment:** Docker & Google Kubernetes Engine (GKE)
- **Load Testing:** k6
- **CI/CD:** GitHub Actions (lint, typecheck, build)
- **Git Hooks:** Husky (pre-commit: format, pre-push: lint + typecheck)

## Load-Test Szenario (k6)

Das k6-Skript simuliert einen realistischen Ticket-Sale-Lifecycle:

| Phase             | Dauer | Requests/s | Beschreibung                                  |
| ----------------- | ----- | ---------- | --------------------------------------------- |
| 1. Warm-Up        | 2 min | 1.000      | Nutzer laden die Seite, checken Verfügbarkeit |
| 2. Pre-Sale Hype  | 2 min | 10.000     | Countdown läuft, Nutzer refreshen             |
| 3. Sale Opening   | 3 min | 50.000     | Verkaufsstart – maximaler Traffic             |
| 4. Sustained Load | 5 min | 50.000     | Tickets werden verkauft, Counter sinkt        |
| 5. Sold Out       | 2 min | 20.000     | Tickets ausverkauft, 409-Responses steigen    |
| 6. Cool Down      | 1 min | 1.000      | Traffic normalisiert sich                     |

**Ziel:** Zeigen, wie das System unter Last skaliert, wann Autoscaling greift, und wie sich die Metriken bei Sold-Out verändern (Error-Rate steigt, Latenz bleibt stabil).

## Observability & Monitoring

- **Prometheus:** Sammelt Metriken von der App. Scraped alle 5 Sekunden den `/metrics`-Endpunkt der Fastify-Server und speichert Zeitreihendaten (RPS, Latenz-Histogramme, Error-Counter). Läuft lokal als Docker-Container.
- **Grafana:** Visualisierungs-Tool, das sich mit Prometheus verbindet und Live-Dashboards baut (Linien-Charts, Heatmaps, Gauges). Die Dashboards werden als JSON im Repo versioniert.
- **k6:** Open-Source Lasttest-Tool von Grafana Labs. Simuliert tausende parallele User via JavaScript-Skripte. Exportiert Ergebnisse direkt an Prometheus → Live-Visualisierung in Grafana während des Tests.
- **README-Beweise:** Screenshots der Grafana-Dashboards unter Last als Nachweis der Skalierbarkeit.

## Architectural Rules

1.  **Strict Async Writes:** Die API darf niemals direkt in die Datenbank schreiben. Alle Schreib-Intents müssen in Pub/Sub gepuffert werden.
2.  **Read-Heavy Optimization:** Die API liest Ticket-Verfügbarkeiten ausschließlich aus dem Redis-Cache.
3.  **Type Safety:** Zod-Schemas generieren die Request-Typen. Drizzle generiert die Datenbank-Typen. Keine doppelten manuellen Typ-Deklarationen.
4.  **Database Agnosticism:** Die Datenbankschicht muss so in Drizzle abstrahiert werden, dass ein späterer Wechsel von Cloud SQL zu Cloud Spanner mit minimalem Refactoring möglich ist.
