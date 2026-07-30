# Load Tests

k6-Lasttests für das High-Frequency Ticket System.

Die reproduzierbare Erfassung, Auswertung und Markdown-Generierung ist unter
`scripts/load-test/` umgesetzt. Der [Leitfaden](../scripts/load-test/README.md)
trennt Rohdaten, deterministische Analyse und Report-Rendering:

```bash
pnpm spike:report                 # kompletter Lauf: seed -> Last -> Drain -> Report (braucht Live-Stack)
pnpm spike:analyze -- <run-dir>   # rein: Artefakte -> derived.json + report.md (keine Infra noetig)
pnpm spike:compare -- <a> <b>     # zwei Laeufe vergleichen (verweigert inkompatible Kapazitaets-Claims)
pnpm spike:report:test            # reine Unit-/Golden-Tests (laufen auch in CI)
```

Rohartefakte landen unter `artifacts/load-tests/<run-id>/` (gitignored); ein geprüfter Baseline-Report wird per Hand nach `docs/reports/` kopiert.

## Baselines

- **[Baseline A vom 2026-07-14](../docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md)** — erster lokaler Spike-Lauf. Messkonfiguration, Befund, Grenzen der Aussagekraft und ein einklappbarer Anhang mit den Grafana-Screenshots. Belegt keine 50k RPS: Der lokale k6-Runner verwarf 68,24 % der geplanten Iterationen.
- **[Baseline B vom 2026-07-26](../docs/reports/baseline-b-2026-07-26/LOAD-TEST-REPORT-2026-07-26.md)** — erster Lauf nach dem Reserve/Pay-Split (ADR-028) und der Hot-Row-Entfernung, und erster End-to-End-Lauf von `pnpm spike:report`. Belegt ebenfalls **keine** 50k RPS (67,66 % dropped iterations, `maxVUs`-Deckel erreicht, Generator co-lokalisiert), zeigt aber fachliche Korrektheit unter ~14 min Dauerlast: 867.575 persistierte Orders, 0 Nachrichtenverlust, exakte Inventar-Erhaltung, 0 Oversell, 0 Drift. E2E-Mittel 406 s → 7,52 s gegenueber Baseline A. Die `system=fail`- und Drain-Timeout-Signale des Laufs sind Defekte der Messkette (siehe Report §4) und als Todos erfasst.
- **[Baseline C vom 2026-07-26 (Abend)](../docs/reports/baseline-c-2026-07-26/LOAD-TEST-REPORT-2026-07-26.md)** — erster Lauf nach den Messketten-Fixes und der erste, der **tatsaechlich ausverkauft** ist (`available = 0`). Belegt weiterhin keine 50k RPS (21,85 % dropped — das k6-VU-Budget reichte nicht, als die Latenz stieg), dafuer 957.053 persistierte Orders in 6,4 min bei 0 Fehlern, E2E-Mittel 0,24 s und sauberem Drain (15 s). Lokalisiert den naechsten Engpass praezise: der **DB-Connection-Pool** (1.070 wartende Acquirer bei Pool 20, 0 Lock-Waits). Zwei neue Defekte: Reconcile erfindet Phantom-Inventar (389 Ansprueche ueber Kapazitaet) und der Drift-Gauge ist dafuer blind.

> Vor dem naechsten Kapazitaetslauf (Baseline D) zuerst den Abschnitt
> „Backlog: Baseline-C-Nachlauf" in [`docs/TODO.md`](../docs/TODO.md) abarbeiten.
> Die P0-Defekte aus dem B-Nachlauf sind erledigt (Baseline C belegt das); offen
> sind jetzt das Phantom-Inventar im Reconcile, der blinde Drift-Gauge und der
> DB-Pool als Engpass.

## Voraussetzungen

```bash
brew install k6
```

Lokale Docker-Container müssen laufen:

```bash
docker compose ps
# falls nicht: docker compose up -d
```

## API/Worker fuer den Lasttest starten (gebauter Stand, nicht `pnpm dev`)

Fuer einen belastbaren Kapazitaetslauf (Baseline B) duerfen API und Worker **nicht**
im Dev-Modus laufen. `pnpm dev` startet `dev` via `tsc-watch --onSuccess`, das
`fastify start` mit `-P` (pino-pretty — ein synchroner, den Event-Loop
blockierender Log-Transform) faehrt und zusaetzlich einen TS-Compiler + FS-Watcher
mitlaufen laesst, der lokal um dieselben Cores wie k6/Postgres/Redis/Prometheus
konkurriert (ein FS-Event mitten im Lauf triggert sogar Rebuild + Restart).

Stattdessen je Service den dedizierten `start:loadtest`-Task nutzen — kompiliert
`dist/app.js`, startet `fastify start` **ohne** `-P` und mit
`NODE_ENV=production`/`LOG_LEVEL=warn`/`-l warn`:

```bash
pnpm --filter api run start:loadtest      # API auf :10002
pnpm --filter worker run start:loadtest   # Worker auf :10003
```

Die Dev-Tasks (`pnpm dev`) bleiben unveraendert und weiterhin die Wahl fuer die
lokale Entwicklung.

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
3. Der monotone Worker-Counter `orders_completed_total` (`/metrics`) wird alle 3s gepollt; stagniert die Zahl abgeschlossener Orders für 3 aufeinanderfolgende Polls (Plateau, relativ zum ersten Poll-Wert), wird Phase A per `SIGINT` (graceful k6-Stop) beendet. Der **Auslöser** ist bewusst nicht `available` — das oszilliert seit der Cancel-/Abandonment-Modellierung (Cancel macht `INCR available`) und würde Phase A verfrüht stoppen. `available` wird erst **nach** dem Plateau einmal gelesen, um Ausverkauf von Stall zu unterscheiden (siehe „Sold-Out vs. Stall" unten).
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

### Diagnose-Metriken

Zusätzlich zu den eingebauten k6-Metriken emittiert `scenario-helpers.js` eigene
Counter (`k6/metrics`), damit Funnel und Fehlerbild lastseitig auswertbar sind:

- **Funnel:** `funnel_reserved` (buy 202), `funnel_paid` (pay 200),
  `funnel_cancelled` (cancel 200), `funnel_sold_out` (buy 409),
  `funnel_too_early` (buy 425), `funnel_abandoned` (reserviert, nie
  bezahlt/storniert). Die Abbruchrate ist damit `1 − funnel_paid/funnel_reserved`.
- **`requests_by_status`** — getaggt nach `{ endpoint, status }`: HTTP-Status-
  Verteilung je Stufe.
- **`transport_errors`** — getaggt nach `{ endpoint, error_code }`: Requests, die
  gar keine App-Response bekamen (Status 0 / gesetzter `error_code`) — genau die
  ~0,28 % aus Baseline A, jetzt nach Stufe und Fehlerklasse aufschlüsselbar.

Die Tags erscheinen als Labels im Prometheus-Remote-Write bzw. als Sub-Metriken
im JSON-/`--summary-mode=full`-Output (die kompakte End-Summary aggregiert sie).

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

Die pnpm-Skripte `seed`/`spike`/`bench:hot-row` laden `.env` automatisch via
`node --env-file-if-exists=.env`. Precedence: **Shell-inline > `.env` > Default**
(ein inline gesetzter Wert wie `SALE_OPENS_IN_SECONDS=0 pnpm seed` schlägt `.env`;
fehlt `.env`, greifen die Defaults). Ein direktes `node scripts/local/…` ohne den
Flag liest `.env` nicht.

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
| `K6_PROMETHEUS_RW`               | `false`                                | `true` aktiviert k6s Prometheus-Remote-Write (Default **aus**, s. u.)     |
| `K6_PROMETHEUS_RW_SERVER_URL`    | `http://localhost:10007/api/v1/write`  | Prometheus Remote-Write-Endpoint fuer k6-Metriken                         |

## k6-Remote-Write ist standardmaessig aus

`pnpm spike` und `pnpm spike:report` starten k6 **ohne** `--out experimental-prometheus-rw`.
Grund: der Report liest gar keine k6-Serien aus Prometheus — alle Queries in
`load-tests/report-queries.json` gehen gegen `job="api"` bzw. `job="worker"`. Das
Remote-Write diente nur dem Live-Blick in Grafana, trieb aber in Baseline B durch
die `{endpoint,status}`-Tags pro Iteration `hts-prometheus` auf 5,5 GiB, bis es mit
`503 Service Unavailable` antwortete — und nahm damit genau die Daten mit, die der
Report braucht (`apiUp`/`workerUp` wurden `null`, beide Peak-Throughput-Queries
unauswertbar).

Fuer einen kleinen Debug-Lauf, bei dem man die k6-Metriken live in Grafana sehen
will, explizit aktivieren:

```bash
K6_PROMETHEUS_RW=true pnpm spike
```

## Sold-Out vs. Stall

Ein Plateau des Completion-Counters ist **kein** Beweis fuer einen Ausverkauf. Die
Orchestrierung prueft daher zusaetzlich den Rest-Bestand:

- `available == 0` → echter Ausverkauf (`stopReason: "sold-out"`)
- `available > 0` → **Stall** (`stopReason: "stalled"`), z. B. durch
  Host-Contention unter Generator-Saturation
- Bestand nicht lesbar → bleibt `stalled`, nie ein behaupteter Ausverkauf

Beide Faelle beenden die Sustain-Stage (die restliche Zeit misst nichts), aber der
Grund landet in `k6/phase-a-meta.json` (`stopReason`, `availableAtStop`) und wird
im Log als Warnung ausgegeben. Baseline B stoppte so bei 888 s von 990 s mit
**89.359 noch verfuegbaren Tickets** — und beantwortete damit nicht, wie lange ein
1M-Ausverkauf dauert.
