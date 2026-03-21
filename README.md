# High-Frequency Ticket System

Asynchrones, hochskalierbares Ticket-System fuer den Verkauf von Frequency Festival Tickets in St. Poelten.

Das Projekt ist als produktionsnahes End-to-End System umgesetzt: API Gateway, Worker, Queueing, Cache-First Reads, relationale Persistenz, Lasttests und Observability.

## Produktziel

Das System verarbeitet extreme Lastspitzen zum Verkaufsstart, ohne die Datenbank zu ueberfahren.

- API antwortet schnell mit `202 Accepted` statt synchronen Blockaden
- Ticket-Verfuegbarkeit kommt exklusiv aus Redis (Read-Optimierung)
- Alle Writes laufen asynchron ueber Pub/Sub in den Worker
- DB-Konsistenz bleibt durch atomare Write-Logik erhalten

## Kernfunktionen

- Ticket kaufen ueber `POST /api/tickets/:eventId/buy`
- Verfuegbarkeit lesen ueber `GET /api/tickets/:eventId/availability`
- Ticket-Pool resetten (Testbetrieb) ueber `POST /api/tickets/:eventId/reset`
- Health-Endpunkte fuer API und Worker
- Event-spezifische Redis-Keys fuer saubere Multi-Event-Isolation
- Reservierungslogik mit atomarem Redis-Check-and-Decrement

## Architektur auf einen Blick

```mermaid
flowchart TD
	User([NUTZER / BROWSER])

	Frontend["Next.js Frontend (apps/web)<br/>Frequency Festival 20XX - Ticket-Shop<br/>Tailwind CSS"]

	subgraph API [Fastify API Gateway apps-api]
		API_metrics["/metrics<br/>(Prometheus)"]
		API_avail["GET /availability<br/>-> Redis Read"]
		API_buy["POST /tickets/buy<br/>-> Pub/Sub Publish"]
	end

	Prometheus["Prometheus<br/>(Scraping)"]
	Redis[("Redis Cache<br/>(Memorystore)")]
	PubSub[["Google Cloud Pub/Sub<br/>(Message Broker)"]]

	Grafana["Grafana Dashboards<br/>- RPS<br/>- Latenz<br/>- Errors<br/>- Queue"]

	Worker["Fastify Worker (apps/worker)<br/>1. Konsumiert BuyTicketEvent aus Pub/Sub<br/>2. Simuliert Payment Provider Latenz (~1s)<br/>3. CALL buy_ticket(...) in Postgres<br/>4. (Optional) Redis Counter Reconciliation"]

	subgraph DB [PostgreSQL Cloud SQL]
		events[("events<br/>- id<br/>- capacity<br/>- sold_count")]
		tickets[("tickets<br/>- id (UUID)<br/>- event_id<br/>- first_name<br/>- last_name<br/>- status")]
	end

	User --> Frontend
	Frontend -->|"HTTP POST /api/tickets/:eventId/buy<br/>HTTP GET /api/tickets/:eventId/availability"| API

	API_metrics --> Prometheus
	API_avail --> Redis
	API_buy --> PubSub

	Prometheus --> Grafana

	Worker -->|Cache Update| Redis
	PubSub -->|SUBSCRIBE| Worker

	Worker -->|SQL Function call| DB
```

## Ticket-Kauf Flow (Happy Path)

1. Nutzer klickt Ticket kaufen im Frontend.
2. Frontend sendet `POST /api/tickets/{eventId}/buy` mit Personalisierungsdaten.
3. API prueft atomar in Redis, ob noch Verfuegbarkeit vorhanden ist.
4. Bei Erfolg published die API an Pub/Sub und antwortet mit `202 Accepted`.
5. Der Worker konsumiert die Nachricht und simuliert Payment-Latenz.
6. Der Worker finalisiert den Kauf via SQL-Function in PostgreSQL.
7. Der Client kann den finalen Status ueber `orderId` pollen.

### Wichtige Architekturregeln

- Fastify only (API und Worker)
- Keine direkten DB-Writes in der API
- Redis ist die einzige Read-Quelle fuer Availability
- DTOs ueber Zod, DB-Typen ueber Drizzle Inference
- Monorepo mit pnpm Workspaces und Turborepo

Details zu Entscheidungen und Datenfluss:

- `docs/REQUIREMENTS.md`
- `docs/DECISIONS.md`
- `docs/ARCHITECTURE.md`

## Tech Stack

- Language: TypeScript (strict)
- Monorepo: Turborepo + pnpm
- Frontend: Next.js + Tailwind CSS
- API/Worker: Fastify
- Validation: Zod
- DB: PostgreSQL + Drizzle ORM
- Cache: Redis
- Broker: Google Cloud Pub/Sub
- Infra: Docker Compose (lokal), Terraform + GKE (Cloud)
- Observability: Prometheus + Grafana
- Load Testing: k6

## Monorepo Struktur

```text
apps/
	api/      Fastify API Gateway
	worker/   Fastify Async Worker
	web/      Next.js Frontend
packages/
	db/       Drizzle schema, migrations, DB access
	env/      Zod-validierte Environment-Variablen
	types/    Shared DTOs, Fehler, Redis-Key-Utilities
	ui/       Shared UI Komponenten
docs/       Architektur, ADRs, Anforderungen, Roadmap
infra/      Terraform/Kubernetes
load-tests/ k6 Szenarien
```

## Lokales Setup

### Voraussetzungen

- Node.js >= 24
- pnpm >= 10
- Docker + Docker Compose

### 1. Dependencies installieren

```bash
pnpm install
```

### 2. Lokale Infrastruktur starten

```bash
docker compose up -d
```

Startet lokal:

- PostgreSQL auf `localhost:5432`
- Redis auf `localhost:6379`
- Pub/Sub Emulator auf `localhost:8085`

### 3. Environment konfigurieren

Das Projekt validiert Umgebungsvariablen strikt ueber Zod (`packages/env`).

Beispiel fuer `.env` im Repository-Root:

```env
NODE_ENV=development
LOG_LEVEL=info

REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/high_frequency_tickets

GOOGLE_CLOUD_PROJECT=high-frequency-ticket-system
PUBSUB_EMULATOR_HOST=localhost:8085
PUBSUB_TOPIC_BUY_TICKET=buy-ticket
PUBSUB_SUBSCRIPTION_BUY_TICKET=buy-ticket-sub
```

### 4. Entwicklungsmodus starten

```bash
pnpm run dev
```

Standardports:

- API: `http://localhost:10001`
- Web: `http://localhost:10002`
- Worker: `http://localhost:10003`

## API Endpunkte

### Health

```http
GET /health
```

Antwort:

```json
{
  "status": "ok",
  "timestamp": "2026-03-18T10:15:30.000Z",
  "uptime": 1234.56
}
```

### Verfuegbarkeit lesen

```http
GET /api/tickets/:eventId/availability
```

Antwort:

```json
{
  "available": "998742",
  "total": "1000000"
}
```

### Ticket kaufen

```http
POST /api/tickets/:eventId/buy
Content-Type: application/json
```

Request-Body (Beispiel):

```json
{
  "firstName": "Max",
  "lastName": "Mustermann",
  "email": "max@example.com",
  "birthDate": "1998-07-14",
  "street": "Musterstrasse 1",
  "zipCode": "3100",
  "city": "St. Poelten",
  "country": "AT"
}
```

Antwort:

```json
{
  "message": "Ticket purchase queued",
  "orderId": "0f98b0f8-5b8f-4c6d-b2d7-3a8bd2ab5d16"
}
```

### Ticket-Counter resetten (Testflow)

```http
POST /api/tickets/:eventId/reset
```

Antwort:

```json
{
  "message": "Tickets reset successfully"
}
```

## Quality Gates

Alle lokalen Checks analog zur CI:

```bash
CI=1 pnpm run format
CI=1 pnpm run lint
CI=1 pnpm run check-types
CI=1 pnpm run test
```

Service-Build:

```bash
pnpm --filter api run build
pnpm --filter worker run build
pnpm --filter web run build
```

## Lasttest und Monitoring

Das System ist fuer Lastspitzen im Ticket-Sale konzipiert und auf einen realistischen Verkaufszyklus ausgelegt:

- Warm-up
- Pre-sale Hype
- Sale Opening Spike
- Sustained Peak
- Sold-out Transition
- Cool-down

Metriken und Dashboards:

- API Throughput und Latenz (p50/p95/p99)
- Error Rate (inkl. `409 Sold Out`)
- Queue-Verhalten (Backpressure/Throughput)
- Redis-Counter-Verhalten unter Parallelitaet

```mermaid
flowchart LR
	API["Fastify API + Worker"]
	K6["k6 Lasttest"]
	Prometheus[("Prometheus")]
	Grafana["Grafana Panels:<br/>- RPS<br/>- p95<br/>- Errors<br/>- Queue<br/>- Redis"]

	API -->|scrape /metrics<br/>every 5s| Prometheus
	K6 -->|prometheus remote<br/>write| Prometheus
	Grafana -->|query| Prometheus
```

Referenzdokumente:

- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`

## CI/CD

GitHub Actions fuehrt zentral aus:

- Lint
- Typecheck
- Build

Zusatzsicherung lokal ueber Husky:

- `pre-commit`: Format
- `pre-push`: Lint + Typecheck

## Sicherheit und Betriebsverhalten

- Typed Error Handling fuer stabile API-Antworten
- Keine Preisgabe interner Fehlerdetails in produktionsnahen Faellen
- Entkoppelter Write-Pfad fuer robuste Lastspitzenverarbeitung
- Event-spezifische Schluessel verhindern Counter-Kollisionen

## Projektdokumentation

Fuer Architektur- und Entscheidungsdetails:

- `docs/REQUIREMENTS.md`
- `docs/DECISIONS.md`
- `docs/ARCHITECTURE.md`
- `docs/TODO.md`

## Lizenz

Private repository / showcase project.
