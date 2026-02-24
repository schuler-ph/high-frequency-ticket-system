# System Architecture

## High-Level Overview

<!-- TODO: Ersetze dieses ASCII-Diagramm durch ein Draw.io-Diagramm (docs/architecture.drawio) und exportiere es als SVG -->

```
┌─────────────────────────────────────────────────────────────────────┐
│                           NUTZER / BROWSER                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Next.js Frontend (apps/web)                      │
│              Frequency Festival 20XX – Ticket-Shop                  │
│                        Tailwind CSS                                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP POST /api/tickets/buy
                               │ HTTP GET  /api/tickets/availability
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Fastify API Gateway (apps/api)                     │
│                                                                     │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────────┐   │
│  │ /metrics    │    │ GET /availability│    │ POST /tickets/buy │   │
│  │ (Prometheus)│    │ → Redis Read     │    │ → Pub/Sub Publish │   │
│  └─────────────┘    └──────────────────┘    └───────────────────┘   │
└────────┬──────────────────┬──────────────────────────┬──────────────┘
         │                  │                          │
         ▼                  ▼                          ▼
┌──────────────┐   ┌──────────────┐          ┌──────────────────────┐
│  Prometheus  │   │ Redis Cache  │          │  Google Cloud Pub/Sub│
│  (Scraping)  │   │ (Memorystore)│          │  (Message Broker)    │
└──────┬───────┘   └──────────────┘          └──────────┬───────────┘
       │                  ▲                             │
       ▼                  │ Cache Update                │ SUBSCRIBE
┌──────────────┐          │                             ▼
│   Grafana    │   ┌──────┴──────────────────────────────────────────┐
│  Dashboards  │   │              Fastify Worker (apps/worker)       │
│              │   │                                                 │
│  - RPS       │   │  1. Konsumiert BuyTicketEvent aus Pub/Sub       │
│  - Latenz    │   │  2. Prüft DB (Double-Check Verfügbarkeit)       │
│  - Errors    │   │  3. INSERT via Drizzle ORM                      │
│  - Queue     │   │  4. Aktualisiert Redis Counter (DECR)           │
└──────────────┘   └──────────────────────────┬──────────────────-───┘
                                              │
                                              │ Drizzle INSERT
                                              ▼
                   ┌──────────────────────────────────────────────────┐
                   │         PostgreSQL (Cloud SQL)                   │
                   │                                                  │
                   │  ┌────────────┐    ┌─────────────────────┐       │
                   │  │  tickets   │    │      orders         │       │
                   │  │  - id      │    │  - id               │       │
                   │  │  - type    │    │  - ticket_id        │       │
                   │  │  - status  │    │  - user_id          │       │
                   │  │  - price   │    │  - status           │       │
                   │  └────────────┘    │  - created_at       │       │
                   │                    └─────────────────────┘       │
                   └──────────────────────────────────────────────────┘
```

## Datenfluss: Ticket-Kauf (Happy Path)

```
1. Nutzer klickt "Ticket kaufen" im Frontend
2. Frontend sendet POST /api/tickets/buy { userId: "..." }
3. API Gateway prüft Redis: tickets:available > 0 ?
4. ✅ Ja → API published BuyTicketEvent an Pub/Sub → HTTP 202 Accepted
   ❌ Nein → HTTP 409 Conflict (Sold Out)
5. Worker konsumiert BuyTicketEvent aus Pub/Sub
6. Worker prüft PostgreSQL (Double-Check: Race Condition Guard)
7. Worker führt INSERT in orders-Tabelle aus
8. Worker führt Redis DECR tickets:available aus
9. Nutzer pollt GET /api/orders/{orderId} für finalen Status
```

## Datenfluss: Verfügbarkeits-Check

```
1. Frontend sendet GET /api/tickets/availability
2. API liest Redis Key tickets:available
3. API antwortet HTTP 200 { available: 843291, total: 1000000 }
   → Kein DB-Zugriff, Sub-Millisekunden Antwortzeit
```

## Load-Test Szenario (k6 Lastkurve)

```
  RPS
50k ┤                  ┌─────────────────────┐
    │                  │    Sale Opening     │
    │                  │    + Sustained      │
    │                  │                     │
20k ┤                  │                     └──────┐
    │                  │                            │ Sold Out
10k ┤         ┌────────┘                            │
    │         │ Pre-Sale                            │
 1k ┤─────────┘ Hype                                └───-───┐
    │ Warm-Up                                        Cool   │
  0 ┼─────────┬────────┬──────────────────────┬──────┬──────┬──
    0        2min     4min                   12min  14min  15min
```

**1M Tickets** werden über ca. 8 Minuten Peak-Last verkauft.
Das Szenario zeigt: Autoscaling-Verhalten, Sold-Out-Transition (HTTP 202 → 409), Queue-Backpressure und Cache-Performance.

## Monitoring & Observability

```
┌──────────┐   scrape /metrics    ┌────────────┐   query    ┌──────────┐
│ Fastify  │ ──────────────────── │ Prometheus │ ────────── │ Grafana  │
│ API +    │   every 5s           │            │            │          │
│ Worker   │                      └────────────┘            │ Panels:  │
└──────────┘                                                │ - RPS    │
                                                            │ - p95    │
┌──────────┐   prometheus remote   ┌────────────┐           │ - Errors │
│   k6     │ ────────────────────  │ Prometheus │ ────────▶ │ - Queue  │
│ Lasttest │   write               │            │           │ - Redis  │
└──────────┘                       └────────────┘           └──────────┘
```

### Grafana-Dashboards (geplant)

| Dashboard       | Metriken                                      | Quelle                   |
| --------------- | --------------------------------------------- | ------------------------ |
| API Performance | RPS, Latenz (p50/p95/p99), Error Rate         | `prom-client` in Fastify |
| Redis Cache     | Hit/Miss Ratio, Key Count, Memory Usage       | Redis Exporter           |
| Message Queue   | Queue Depth, Processing Rate, Consumer Lag    | Pub/Sub Metrics          |
| k6 Lasttest     | Virtual Users, Request Duration, Failure Rate | k6 → Prometheus          |

## Workspace-Struktur

```
high-frequency-ticket-system/
├── apps/
│   ├── api/          # Fastify API Gateway (HTTP → Redis + Pub/Sub)
│   ├── web/          # Next.js Frontend (Tailwind CSS)
│   └── worker/       # Fastify Worker (Pub/Sub → PostgreSQL + Redis)
├── packages/
│   ├── db/           # Drizzle ORM Schema, Migrations, DB Client
│   ├── types/        # Shared Zod Schemas & TypeScript Types
│   ├── eslint-config/# Shared ESLint Configuration
│   ├── typescript-config/ # Shared tsconfig
│   └── ui/           # Shared UI Components (optional)
├── load-tests/       # k6 Lasttest-Skripte
├── infra/            # Terraform + Kubernetes Manifeste
├── docs/             # Architektur, ADRs, Requirements
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   ├── REQUIREMENTS.md
│   └── TODO.md
└── docker-compose.yml  # Lokales Dev-Setup (PostgreSQL, Redis, Pub/Sub, Grafana)
```
