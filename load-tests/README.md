# Load Tests

k6-Lasttests für das High-Frequency Ticket System.

Die reproduzierbare Erfassung, Auswertung und Markdown-Generierung fuer kuenftige Baselines ist in `docs/LOAD-TEST-REPORT-AUTOMATION.md` beschrieben. Der Leitfaden trennt Rohdaten, deterministische Analyse und Report-Rendering, damit Dashboard-Auswertungen nicht erneut manuell oder durch einen KI-Agenten rekonstruiert werden muessen.

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
# Orchestrierter Lauf (empfohlen): seedet, sperrt den Verkauf fuer 60s,
# faehrt Phase A bis Sold-Out, dann Phase B (Cool-Down)
pnpm spike

# Mit custom Unlock-Delay, Base-URL oder Event-ID
SALE_OPENS_IN_SECONDS=30 BASE_URL=http://localhost:10002 EVENT_ID=freq-2025 pnpm spike
```

## Reaktive Zwei-Phasen-Orchestrierung

`pnpm spike` ruft `scripts/local/run-spike.mjs` auf (siehe ADR-025), das:

1. `scripts/local/reset-seed.mjs` mit `SALE_OPENS_IN_SECONDS` (Default: `60`) ausführt — setzt `available` zurück und schreibt den Sale-Unlock-Zeitpunkt (`opensAt`) in Redis.
2. **Phase A** (`spike-phase-a.js`) startet: Warm-Up 1.000 RPS flat/45s (Verkauf gesperrt, 425-Responses) → Ramp-Up 1.000→5.000 RPS/45s → Sustain 5.000 RPS (15 min Sicherheitsnetz).
3. Die Verfügbarkeits-Route wird alle 3s gepollt; bei 3 aufeinanderfolgenden `available: 0`-Antworten wird Phase A per `SIGINT` (graceful k6-Stop) beendet.
4. **Phase B** (`spike-phase-b.js`) startet: Cool-Down 1.000 RPS flat/1min.

Ohne Orchestrator lässt sich jede Phase auch einzeln fahren (z.B. zum Debuggen), dann aber ohne reaktiven Sold-Out-Stop:

```bash
k6 run load-tests/spike-phase-a.js
k6 run load-tests/spike-phase-b.js
```

## Umgebungsvariablen

| Variable                         | Default                                | Beschreibung                                                       |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `BASE_URL`                       | `http://localhost:10002`               | API-Basis-URL                                                      |
| `EVENT_ID`                       | `00000000-0000-4000-8000-000000000000` | Event-ID für Ticket-Requests                                       |
| `SALE_OPENS_IN_SECONDS`          | `60`                                   | Sekunden bis zum Sale-Unlock (an `reset-seed.mjs` weitergereicht)  |
| `SPIKE_POLL_INTERVAL_MS`         | `3000`                                 | Intervall der Availability-Polls in der Orchestrierung             |
| `SPIKE_SOLDOUT_CONFIRM_POLLS`    | `3`                                    | Anzahl aufeinanderfolgender `available: 0`-Polls bis Sold-Out gilt |
| `SPIKE_GRACEFUL_STOP_TIMEOUT_MS` | `40000`                                | Timeout fuer den graceful k6-Stop, bevor SIGKILL erzwungen wird    |
| `K6_PROMETHEUS_RW_SERVER_URL`    | `http://localhost:10007/api/v1/write`  | Prometheus Remote-Write-Endpoint fuer k6-Metriken                  |
