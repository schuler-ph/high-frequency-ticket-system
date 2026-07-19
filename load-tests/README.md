# Load Tests

k6-Lasttests für das High-Frequency Ticket System.

Die reproduzierbare Erfassung, Auswertung und Markdown-Generierung fuer kuenftige Baselines ist in `docs/LOAD-TEST-REPORT-AUTOMATION.md` beschrieben. Der Leitfaden trennt Rohdaten, deterministische Analyse und Report-Rendering, damit Dashboard-Auswertungen nicht erneut manuell oder durch einen KI-Agenten rekonstruiert werden muessen.

## Erste Baseline

Der erste lokale Spike-Lauf ist als [Baseline A vom 2026-07-14](../docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md) dokumentiert. Der Report enthaelt Messkonfiguration, Befund, Grenzen der Aussagekraft und einen einklappbaren Anhang mit den Grafana-Screenshots. Er belegt keine 50k RPS: Der lokale k6-Runner verwarf 68,24 % der geplanten Iterationen.

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
3. Der monotone Worker-Counter `orders_completed_total` (`/metrics`) wird alle 3s gepollt; stagniert die Zahl abgeschlossener Orders für 3 aufeinanderfolgende Polls (Plateau, erst ab `completed > 0`), wird Phase A per `SIGINT` (graceful k6-Stop) beendet. **Nicht** mehr `available`: das oszilliert seit der Cancel-/Abandonment-Modellierung (Cancel macht `INCR available`) und würde Phase A verfrüht stoppen.
4. **Phase B** (`spike-phase-b.js`) startet: Cool-Down 1.000 RPS flat/1min.

Ohne Orchestrator lässt sich jede Phase auch einzeln fahren (z.B. zum Debuggen), dann aber ohne reaktiven Sold-Out-Stop:

```bash
k6 run load-tests/spike-phase-a.js
k6 run load-tests/spike-phase-b.js
```

## Iterations-Flow (Checkout-Funnel)

Seit dem Reserve/Pay/Publish-Split (ADR-028) fuehrt jede Kauf-Iteration den
**vollen Checkout-Funnel** aus `load-tests/lib/scenario-helpers.js` aus — nicht
mehr reserve-only:

1. `POST /api/tickets/:eventId/buy` — reserviert (`202` liefert `orderId`;
   `409` Sold-Out / `425` Too-Early beenden die Iteration, beides erwartet).
2. `POST /api/orders/:orderId/pay` — bestaetigt die (simulierte) Zahlung und
   **published** den `BuyTicketEvent`; erst danach persistiert der Worker.
   Fake-Karten-DTO (Testnummer `4242…`), keine echten Zahlungsdaten.
3. _optional_ `GET /api/orders/:orderId` — pollt bis `completed`/`failed`
   (nur wenn `CHECKOUT_POLL=true`).

Wichtig: Ohne den Pay-Schritt published nichts und der Worker sieht keine Order
(**0 abgeschlossene Orders** trotz sinkender `available`) — genau der Grund,
warum das alte reserve-only-Skript keine Baseline-B-Persistenz messen konnte.
Jede Iteration trägt via `tags: { endpoint: … }` (`buy`/`pay`/`cancel`/
`availability`/`orders`) einen Endpoint-Tag für die per-Endpoint-Auswertung.

### Abandonment-Verzweigung nach dem Reserve

Nach `buy` verzweigt jede Iteration (env-konfigurierbar):

- **~88 %** (`PAY_RATE`) → `pay` (bezahlt, published, wird persistiert)
- **~8 %** (`CANCEL_RATE`) → `cancel` (gibt die Reservierung frei → `INCR available`)
- **Rest ~4 %** → Abbruch **ohne** Cancel: die Ledger-Reservierung bleibt als
  Phantom-Anspruch stehen (Reaper-Kandidat, Phase 6)

### Lastprofile (`LOAD_PROFILE`)

Da das Backend nach dem Reserve/Pay-Split **keine** kuenstliche Latenz mehr hat,
lebt die Checkout-Denkzeit als explizites `sleep()` im k6-Skript (ADR-028):

- **`capacity`** (Default): keine Denkzeit, `buy`→`pay` back-to-back → misst rohe
  Infra-Kapazitaet (Vergleichsgrundlage fuer Baseline B).
- **`realism`**: randomisierte Denkzeit ~2–8 s (`THINK_TIME_MIN`/`THINK_TIME_MAX`)
  → misst gleichzeitig gehaltene Ledger-Reservierungen + Redis-Memory. Die
  Denkzeit blaeht die VU-Zahl massiv auf und ist der Grund fuer die ~20k-VU-/
  verteilter-Runner-Anforderung in Stage 4.

## Umgebungsvariablen

| Variable                         | Default                                | Beschreibung                                                              |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `BASE_URL`                       | `http://localhost:10002`               | API-Basis-URL                                                             |
| `EVENT_ID`                       | `00000000-0000-4000-8000-000000000000` | Event-ID für Ticket-Requests                                              |
| `CHECKOUT_POLL`                  | `false`                                | `true` aktiviert den `GET /orders/:orderId`-Poll bis `completed`/`failed` |
| `CHECKOUT_POLL_MAX_ATTEMPTS`     | `10`                                   | Max. Poll-Versuche pro Order, bevor aufgegeben wird                       |
| `CHECKOUT_POLL_INTERVAL`         | `1`                                    | Sekunden zwischen zwei Poll-Versuchen                                     |
| `LOAD_PROFILE`                   | `capacity`                             | `capacity` (keine Denkzeit) oder `realism` (randomisierte Denkzeit)       |
| `THINK_TIME_MIN`                 | `2`                                    | realism: minimale Denkzeit (Sekunden) nach dem Reserve                    |
| `THINK_TIME_MAX`                 | `8`                                    | realism: maximale Denkzeit (Sekunden) nach dem Reserve                    |
| `PAY_RATE`                       | `0.88`                                 | Anteil der Reservierungen, die bezahlt werden                             |
| `CANCEL_RATE`                    | `0.08`                                 | Anteil, der via `cancel` abbricht (Rest = Abbruch ohne Cancel)            |
| `SALE_OPENS_IN_SECONDS`          | `60`                                   | Sekunden bis zum Sale-Unlock (an `reset-seed.mjs` weitergereicht)         |
| `SPIKE_POLL_INTERVAL_MS`         | `3000`                                 | Intervall der Completion-Counter-Polls in der Orchestrierung              |
| `SPIKE_SOLDOUT_CONFIRM_POLLS`    | `3`                                    | Anzahl aufeinanderfolgender Polls ohne Fortschritt bis Sold-Out gilt      |
| `WORKER_METRICS_URL`             | `http://localhost:10003/metrics`       | Worker-`/metrics`-Endpoint für den `orders_completed_total`-Poll          |
| `SPIKE_GRACEFUL_STOP_TIMEOUT_MS` | `40000`                                | Timeout fuer den graceful k6-Stop, bevor SIGKILL erzwungen wird           |
| `K6_PROMETHEUS_RW_SERVER_URL`    | `http://localhost:10007/api/v1/write`  | Prometheus Remote-Write-Endpoint fuer k6-Metriken                         |
