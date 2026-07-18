# Hot-Row Micro-Benchmark (Stage 2 / Backlog #7)

Isolierter Nachweis, dass der `sold_count`-Hot-Row-`UPDATE` in `buy_ticket` der
naechste echte Durchsatz-Limiter ist — und Vorher/Nachher-Vergleich fuer seine
Entfernung.

## Warum ein eigener Micro-Benchmark?

Seit dem Reserve/Pay-Split (ADR-028) published `POST /buy` **nicht** mehr; der
bestehende k6-Lasttest treibt den Worker daher gar nicht an. Um den Hot-Row
isoliert zu vermessen, publiziert `scripts/local/bench-hot-row.mjs` die
`BuyTicketEvent`s **direkt** an den Pub/Sub-Emulator (umgeht API + Redis-Reserve)
und misst, wie schnell der Worker sie via `buy_ticket` persistiert.

Bei **einem** Event serialisieren alle parallelen Worker-Transaktionen auf
derselben `events`-Row: der `UPDATE events SET sold_count = sold_count + 1` haelt
den Row-Lock fuer die gesamte Transaktionsdauer, alle anderen Backends warten.

## Gemessene Signale (rein aus PostgreSQL)

- **Durchsatz:** persistierte Tickets / Sekunde (Drain-Wallclock).
- **Hot-Row-Kontention:** Peak/Avg paralleler Backends mit
  `wait_event_type = 'Lock'` aus `pg_stat_activity` (Sampling waehrend Drain).
- **Best-effort:** `db_query_duration_seconds{query="buy_ticket"}` und
  `db_locks_waiting` aus dem Worker-`/metrics` (inkl. Pool-Acquire-Wartezeit).

## Ablauf (reproduzierbar)

```bash
# 1. Infra + sauberer Startzustand (ein Event, leere tickets)
docker compose up -d
pnpm seed

# 2. Worker mit erhoehter Flow-Control + groesserem Pool starten
#    (>1.000 In-Flight-Messages, damit der Hot-Row wirklich saturiert)
cd apps/worker && pnpm build
PUBSUB_FLOW_CONTROL_MAX_MESSAGES=2000 DATABASE_POOL_MAX=50 \
  node_modules/.bin/fastify start -l warn -p 10003 dist/app.js

# 3. In einem zweiten Terminal: 20k Events publizieren + messen
BENCH_MESSAGES=20000 pnpm bench:hot-row
```

Knobs (env): `BENCH_MESSAGES`, `BENCH_EVENT_ID`, `BENCH_PUBLISH_BATCH`,
`BENCH_SAMPLE_INTERVAL_MS`, `BENCH_DRAIN_TIMEOUT_MS`, `BENCH_WORKER_METRICS_URL`.

## Ergebnisse

Konfiguration: 20.000 Messages, 1 Event, `PUBSUB_FLOW_CONTROL_MAX_MESSAGES=2000`,
`DATABASE_POOL_MAX=50`, lokal (Docker `hts-postgres`), 2026-07-18.

### BEFORE — `buy_ticket` mit `sold_count`-Hot-Row-UPDATE (Migration 0008)

| Metrik                                     | Wert              |
| ------------------------------------------ | ----------------- |
| Durchsatz                                  | **235 tickets/s** |
| Peak Lock-Wait-Backends                    | **49 / 50**       |
| Avg Lock-Wait-Backends                     | 39,0              |
| `buy_ticket`-Call-Latenz (inkl. Pool-Wait) | ~37,6 s avg       |
| Drain-Wallclock (20k)                      | 85,0 s            |

**Deutung:** Fast der komplette Connection-Pool (49 von 50) haengt permanent im
Lock-Wait auf derselben `events`-Row. Der Durchsatz ist damit durch die
serielle Row-Lock-Kritische-Sektion gedeckelt (~235/s ≈ 1 / Row-Lock-Hold), voellig
unabhaengig von der Pool-Groesse. Das ist der Hot-Row-Limiter in Reinform.

### AFTER — `buy_ticket` ohne `sold_count`-Hot-Row-UPDATE (Migration 0009)

_Wird nach der Umsetzung von Backlog #7 ergaenzt._
