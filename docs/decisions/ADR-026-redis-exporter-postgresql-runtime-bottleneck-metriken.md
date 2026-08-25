# ADR-026: Redis-Exporter + PostgreSQL-/Runtime-Bottleneck-Metriken

- **Status:** Fertig
- **Datum:** 2026-07-15
- **Kontext:** Baseline A (`docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md`) traf den Pub/Sub-Flow-Control-Deckel, bevor die Datenbank als Limiter nachweisbar war. Die Redis-Dashboards standen auf `No data`, weil kein `redis_exporter` deployt war, und es fehlten Signale zur belastbaren Engpass-Zuordnung (Pool-Saettigung, Query-Latenz, Lock-Kontention). Prozess-CPU und Event-Loop-Lag lagen bereits durch `prom-client`-Default-Metriken vor, waren aber in keinem Dashboard sichtbar.
- **Entscheidung:**
  1. `oliver006/redis_exporter` als Docker-Compose-Service (`hts-redis-exporter`, Host-Port `10009`, Container-Port `9121`) mit eigenem Prometheus-Scrape-Job (`job: redis`, container-intern per Service-Name). Aktiviert die bestehenden Redis-Performance-Panels.
  2. Worker-DB-Metriken via `prom-client`: `db_pool_connections{state}` (Gauge, auf jedem Scrape via `collect()` aus `pool.totalCount/idleCount/waitingCount` — `waiting` ist das Pool-Wait-Backpressure-Signal), `db_query_duration_seconds{query}` (Histogram) und `db_locks_waiting` (Gauge, per Intervall aus `pg_stat_activity` gesampelt).
  3. Query-Latenz wird am Kompositions-Wurzelpunkt (`defaultPubSubListenerRouteDeps`) via `timeDbQuery(name, fn)` gemessen, nicht durch Monkey-Patching von `pool.query`. `@repo/db` bleibt frei von Metrik-Kopplung; nur der Pool und ein `countWaitingLockBackends()`-Helper werden exportiert.
  4. Neues Dashboard „DB & Runtime“ (`monitoring/grafana/provisioning/dashboards/db-runtime.json`): Pool-Connections/-Wait, Query-Latenz (p50/p95/p99 + p95 je Query), Query-Durchsatz, Lock-Waits, Event-Loop-Lag (p99/mean) und Prozess-CPU fuer API und Worker.
- **Begruendung:**
  - Der `collect()`-Callback am Pool-Gauge kostet keine DB-Query — er liest nur In-Memory-Zaehler des Pools und ist damit scrape-guenstig. Lock-Waits kosten eine Query gegen `pg_stat_activity` und werden deshalb per Intervall (5 s, entspricht `scrape_interval`) statt pro Scrape gesampelt.
  - Timing am DI-Seam statt `pool.query`-Wrapper vermeidet fragile Overload-/Callback-Typprobleme und haelt die geteilte DB-Schicht rein; die drei relevanten Worker-Queries (`buy_ticket`, `list_event_inventory`, `mark_order_failed`) sind namentlich getrennt messbar.
  - `redis_exporter` ist der Standardweg fuer Redis-INFO-Metriken und liefert exakt die Serien-Namen, auf die die bestehenden Panels bereits verweisen.
- **Alternativen:**
  - `postgres_exporter` statt In-Worker-Metriken: liefert reichhaltige Server-Metriken, aber die pro-Query- und Pool-Wait-Sicht des Anwendungsprozesses (die fuer die #7-Analyse zaehlt) deckt er nicht ab; zusaetzlicher Container-Overhead.
  - `pool.query` global monkey-patchen: erfasst jede Query automatisch, aber mit hohem Typrisiko (node-postgres-Overloads inkl. Callback-Form) und Kopplung von `@repo/db` an die Worker-Registry.
  - CPU-/Event-Loop-Metriken neu instrumentieren: unnoetig, da `collectDefaultMetrics` sie bereits exponiert — es fehlte nur die Visualisierung.
- **Umsetzung:**
  - `docker-compose.yml` (`redis_exporter`-Service), `monitoring/prometheus.yml` (`job: redis`)
  - `packages/db/src/index.ts` (`pool`-Export), `packages/db/src/order-processing.ts` (`countWaitingLockBackends`)
  - `apps/worker/src/lib/metrics.ts` (`db_pool_connections`, `db_query_duration_seconds`, `db_locks_waiting`, `timeDbQuery`)
  - `apps/worker/src/plugins/db-metrics.ts` (Lock-Wait-Sampler mit onReady/onClose-Lifecycle)
  - `apps/worker/src/routes/pubsub-listener.ts` (Query-Timing an den DB-Deps)
  - `monitoring/grafana/provisioning/dashboards/db-runtime.json`
  - `docs/ARCHITECTURE.md`, `docs/REQUIREMENTS.md`

## Nachtrag 2026-08-25: Event-Loop-Lag entfernt

Die `nodejs_eventloop_lag_*`-Defaults von `prom-client` (Entscheidung 4, „Event-Loop-Lag (p99/mean)") sind aus beiden Registries und aus dem Dashboard entfernt. Sie haben nie gemessen, was sie versprachen: die Abtastung laeuft mit 10 ms Aufloesung, sodass der Boden der Verteilung die Abtastperiode selbst ist, und das zugrunde liegende Histogramm wird in jedem Collect zurueckgesetzt. In Baseline E lag der Mittelwert vor dem `buy-only`-Lauf bei 10,6 ms und danach bei 11,0 ms — die Metrik hat die Last nicht gesehen. Eine tote Metrik ist schlimmer als keine, weil sie als Entlastungsbeweis gelesen wird („Event-Loop war frei, also …"). Eine belastbare Event-Loop-Messung braucht eine eigene Sampling-Strategie und ist bewusst nicht Teil von Phase 4.13; bis dahin fehlt das Signal sichtbar statt falsch. Prozess-CPU bleibt als Runtime-Signal erhalten.

## Nachtrag 2026-08-25: Lock-Waits nach `wait_event_type`

Der Gauge `db_locks_waiting` filterte auf `wait_event_type = 'Lock'` (Heavyweight-Locks). Die tatsächliche Contention-Form von `buy_ticket` ist eine andere: die Fremdschlüssel von `orders` und `tickets` nehmen je Aufruf zweimal `FOR KEY SHARE` auf dieselbe `events`-Zeile, was als MultiXact-SLRU-Druck unter `LWLock` erscheint. Ein gemessener Wert 0 war deshalb kein Freispruch — Baseline E zeigte bei 3.760 wartenden Pool-Acquirern `db_locks_waiting = 0`. Der Gauge trägt jetzt das Label `wait_event_type` mit den Serien `Lock` und `LWLock` (beide immer vorhanden, bei 0 gefüllt), die Query gruppiert `pg_stat_activity` entsprechend, das Panel zeigt beide Klassen. `countWaitingLockBackends()` heißt `countWaitingBackendsByWaitEventType()`.
