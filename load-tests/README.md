# Load Tests

k6-Lasttests für das High-Frequency Ticket System.

## Voraussetzungen

```bash
brew install k6
```

Lokale Docker-Container müssen laufen:

```bash
docker compose ps
# falls nicht: docker compose up -d
```

## Ausführen

```bash
# Lokal gegen Docker-Setup
k6 run load-tests/spike.js

# Mit custom Base-URL oder Event-ID
BASE_URL=http://localhost:10002 EVENT_ID=freq-2025 k6 run load-tests/spike.js
```

## Lastprofil

| Phase            | Dauer | Ziel-RPS | Beschreibung                      |
| ---------------- | ----- | -------- | --------------------------------- |
| 1. Warm-Up       | 2 min | 1.000    | Nutzer laden die Seite            |
| 2. Pre-Sale Hype | 2 min | 10.000   | Countdown, Nutzer refreshen       |
| 3. Sale Opening  | 3 min | 50.000   | Verkaufsstart – maximaler Traffic |
| 4. Sustained     | 5 min | 50.000   | Tickets werden verkauft           |
| 5. Sold Out      | 2 min | 20.000   | 409-Responses steigen             |
| 6. Cool Down     | 1 min | 1.000    | Traffic normalisiert sich         |

**Gesamt: ~15 Minuten**

## Umgebungsvariablen

| Variable   | Default                  | Beschreibung                 |
| ---------- | ------------------------ | ---------------------------- |
| `BASE_URL` | `http://localhost:10002` | API-Basis-URL                |
| `EVENT_ID` | `freq-2025`              | Event-ID für Ticket-Requests |
