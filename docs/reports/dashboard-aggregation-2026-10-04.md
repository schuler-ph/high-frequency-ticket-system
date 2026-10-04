# Dashboard-Aggregation bei N Instanzen (2026-10-04)

Audit für Phase 5.3 (REQ-D04): Zeigt jedes Panel mit drei API-Pods und N
Worker-Pods noch die Wahrheit? Grundlage sind die Metrik-Typen aus `# TYPE`
der laufenden Pods (`/metrics` von API und Worker, Redis-Exporter) und alle
Queries in `monitoring/grafana/provisioning/dashboards/`.

## Regel

| Klasse           | Bedeutung                                              | Aggregation                                                  |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| **Beitrag**      | Counter und Histogramme, jede Instanz zählt ihren Teil | `sum(rate(...))`, Quantile über `sum by (le)`                |
| **Weltzustand**  | Gauge, den jede Instanz gleich sieht (Redis, Postgres) | `max()` (bzw. `max`/`min` bei vorzeichenbehafteten Werten)   |
| **pro Instanz**  | Gauge oder Prozess-Counter einer einzelnen Instanz     | `by (instance)` zeigen, nie verdichten                       |
| **Einzelquelle** | genau ein Exporter (Redis-Exporter in Compose)         | keine nötig; wird sie repliziert, gilt die Weltzustand-Zeile |

## Befund

- **API:** alle 50 Queries auf API-Counter und -Histogramme summierten
  bereits. Drei API-Pods sind für die Dashboards kein Problem.
- **Verdopplung:** `Ticket Status` summierte vier Weltzustand-Gauges
  (`inventory_capacity_tickets`, `inventory_available_tickets`,
  `inventory_sold_tickets`, `reservation_ledger_active`) in 10 Queries. Mit zwei
  Workern zeigte „Kapazität" 2 000 000 statt 1 000 000.
- **Mehrdeutig:** 18 Worker-Gauge-Queries in `Inventory Integrity` und
  `DB & Runtime` aggregierten gar nicht. Mit N Workern entstehen N Linien, und
  Stat-/Gauge-Panels reduzieren sie nach Grafanas eigener Regel.
- **Zwei Fehler-Counter** (`inventory_audit_runs_total`,
  `sold_count_projector_runs_total` mit `result="error"`) liefen ohne `sum`.

## Korrektur

- Weltzustand → `max()`, mit `by (event_id)`, wo die Legende das Event nennt.
- **Capacity Delta** ist vorzeichenbehaftet. `max` allein würde ein negatives
  Delta neben einer Null verstecken, deshalb zeigt die Zeitreihe `max` **und**
  `min` je Event. Das Invarianten-Panel zeigt `max(abs(...))`: es ist nur 0,
  wenn jeder Auditor 0 meldet.
- **Freshness** (Auditor, Projector) ist pro Instanz: `time() - max by
(instance)`. Ein hängender Worker bleibt so als eigene Linie sichtbar,
  statt hinter dem frischesten zu verschwinden (REQ-D04, zweiter Satz).
- **Pool-Gauges** und **Process CPU** zeigen `{{instance}}` in der Legende.
- `db_locks_waiting` stammt aus `pg_locks` der ganzen Datenbank, ist also
  Weltzustand trotz Messung im Worker.

## Beweis

Worker auf zwei Replicas, 75 s nach dem Rollout, gegen den Cluster-Prometheus:

| Query                                       | Ergebnis      |
| ------------------------------------------- | ------------- |
| `count(up{job="worker"}==1)`                | 2             |
| alt: `sum(inventory_capacity_tickets{...})` | **2 000 000** |
| neu: `max(inventory_capacity_tickets{...})` | 1 000 000     |
| `inventory_capacity_delta_tickets{...}` roh | `0`, `0`      |
| neu: `max/min by (event_id) (...)`          | `0` / `0`     |

Gerendert über Grafana (Renderer im Cluster): Stat „Kapazität" zeigt 1 Mil,
„Capacity Delta over time" je eine Linie für `max` und `min`. Danach Worker
zurück auf eine Replica.

## Ohne Service-Metrik im Audit

Zwei Panels in `Pub/Sub Queue` nutzen Serien, die `prom-client` erst nach dem
ersten Inkrement exponiert und die deshalb im Leerlauf fehlten: Redeliveries
und Duplicate Deliveries sowie die E2E-Latenz. Beide sind Beitrag und
summierten bereits. Dazu kommt ein Text-Panel ohne Query in
`Redis Performance`.

## Klassifikation je Panel

### API Performance

| Panel                                       | Metriken                                    | Klasse  | vorher             | nachher            |
| ------------------------------------------- | ------------------------------------------- | ------- | ------------------ | ------------------ |
| Request Rate (RPS)                          | `http_request_duration_seconds` (histogram) | Beitrag | sum                | sum                |
| POST /buy Latency (p50 / p95 / p99)         | `http_request_duration_seconds` (histogram) | Beitrag | sum by (le)        | sum by (le)        |
| GET /availability Latency (p50 / p95 / p99) | `http_request_duration_seconds` (histogram) | Beitrag | sum by (le)        | sum by (le)        |
| Error Rate (5xx / 409 / 410 / 425)          | `http_request_duration_seconds` (histogram) | Beitrag | sum                | sum                |
| Latency by Route (p50 / p95)                | `http_request_duration_seconds` (histogram) | Beitrag | sum by (le, route) | sum by (le, route) |
| POST /pay Latency (p50 / p95 / p99)         | `http_request_duration_seconds` (histogram) | Beitrag | sum by (le)        | sum by (le)        |

### DB & Runtime

| Panel                                                          | Metriken                                                                                                            | Klasse                | vorher             | nachher                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------ | ------------------------ |
| DB Pool Connections (node-postgres) **(korrigiert)**           | `db_pool_connections` (gauge)                                                                                       | pro Instanz           | keine              | max by (instance)        |
| Pool Wait (max queued acquirers im Zeitraum) **(korrigiert)**  | `db_pool_connections` (gauge)                                                                                       | pro Instanz           | keine              | max by (instance)        |
| Lock Waits (max im Zeitraum, Lock vs. LWLock) **(korrigiert)** | `db_locks_waiting` (gauge)                                                                                          | Weltzustand           | keine              | max by (wait_event_type) |
| DB Query Latency (p50 / p95 / p99, all queries)                | `db_query_duration_seconds` (histogram)                                                                             | Beitrag               | sum by (le)        | sum by (le)              |
| DB Query Latency p95 by Query                                  | `db_query_duration_seconds` (histogram)                                                                             | Beitrag               | sum by (le, query) | sum by (le, query)       |
| DB Query Throughput by Query                                   | `db_query_duration_seconds` (histogram)                                                                             | Beitrag               | sum by (query)     | sum by (query)           |
| Process CPU (cores, rate) **(korrigiert)**                     | `process_cpu_seconds_total` (counter)                                                                               | pro Instanz           | keine              | keine                    |
| Sold-count Projector Query Duration                            | `db_query_duration_seconds` (histogram)                                                                             | Beitrag               | sum by (le)        | sum by (le)              |
| Sold-count Projector Write-back Duration                       | `sold_count_projector_duration_seconds` (histogram)                                                                 | Beitrag               | sum by (le)        | sum by (le)              |
| Sold-count Projector Health **(korrigiert)**                   | `sold_count_projector_last_success_timestamp_seconds` (gauge), `sold_count_projector_runs_total` (counter)          | Beitrag + pro Instanz | keine              | max by (instance); sum   |
| Pool Wait during Projector Activity **(korrigiert)**           | `db_pool_connections` (gauge), `db_query_duration_seconds` (histogram), `sold_count_projector_runs_total` (counter) | Beitrag + pro Instanz | keine; sum         | max by (instance); sum   |

### Order Completion Latency

| Panel                                                                                  | Metriken                                | Klasse  | vorher                | nachher               |
| -------------------------------------------------------------------------------------- | --------------------------------------- | ------- | --------------------- | --------------------- |
| Order Completion Latency — Publish (POST /pay) → completed \| failed (p50 / p95 / p99) | `order_e2e_latency_seconds` (histogram) | Beitrag | sum by (le, status)   | sum by (le, status)   |
| Current p50                                                                            | `order_e2e_latency_seconds` (histogram) | Beitrag | sum by (le)           | sum by (le)           |
| Current p95                                                                            | `order_e2e_latency_seconds` (histogram) | Beitrag | sum by (le)           | sum by (le)           |
| Current p99                                                                            | `order_e2e_latency_seconds` (histogram) | Beitrag | sum by (le)           | sum by (le)           |
| p99 (completed only)                                                                   | `order_e2e_latency_seconds` (histogram) | Beitrag | sum by (le)           | sum by (le)           |
| p95 Latency by Event (completed)                                                       | `order_e2e_latency_seconds` (histogram) | Beitrag | sum by (le, event_id) | sum by (le, event_id) |
| Completed + Failed Order Rate (Worker Throughput)                                      | `order_e2e_latency_seconds` (histogram) | Beitrag | sum by (status)       | sum by (status)       |

### Order Lifecycle

| Panel                                                              | Metriken                                                                                                                                                 | Klasse  | vorher            | nachher           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------- | ----------------- |
| Order Throughput (accepted / completed / failed per second)        | `orders_accepted_total` (counter), `orders_completed_total` (counter), `orders_failed_total` (counter), `payments_confirmed_total` (counter)             | Beitrag | sum               | sum               |
| Pending Orders (paid – completed – failed, 5m window)              | `orders_completed_total` (counter), `orders_failed_total` (counter), `payments_confirmed_total` (counter)                                                | Beitrag | sum               | sum               |
| Worker/Published Throughput Ratio (5m)                             | `orders_completed_total` (counter), `payments_confirmed_total` (counter)                                                                                 | Beitrag | sum               | sum               |
| Failure Rate (5m)                                                  | `orders_failed_total` (counter), `payments_confirmed_total` (counter)                                                                                    | Beitrag | sum               | sum               |
| Order Rate by Event                                                | `orders_accepted_total` (counter), `orders_completed_total` (counter), `orders_failed_total` (counter)                                                   | Beitrag | sum by (event_id) | sum by (event_id) |
| Cumulative Order Counts (Dashboard Time Range)                     | `orders_accepted_total` (counter), `orders_completed_total` (counter), `orders_failed_total` (counter), `payments_confirmed_total` (counter)             | Beitrag | sum               | sum               |
| Checkout Funnel (reserved / paid / cancelled / expired per second) | `checkouts_cancelled_total` (counter), `payments_confirmed_total` (counter), `payments_rejected_total` (counter), `reservations_created_total` (counter) | Beitrag | sum               | sum               |
| Checkout Abandon Rate (1 – (paid + expired)/reserved, Zeitraum)    | `payments_confirmed_total` (counter), `payments_rejected_total` (counter), `reservations_created_total` (counter)                                        | Beitrag | sum               | sum               |

### Pub/Sub Queue & Worker Processing

| Panel                                             | Metriken                                                                                                                                                                                        | Klasse  | vorher      | nachher     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------- | ----------- |
| Queue Depth & Processing Rate (Worker-Side Proxy) | `orders_completed_total` (counter), `orders_failed_total` (counter), `payments_confirmed_total` (counter)                                                                                       | Beitrag | sum         | sum         |
| Publish vs. Consumer Rate                         | `orders_completed_total` (counter), `orders_failed_total` (counter), `payments_confirmed_total` (counter), `worker_duplicate_deliveries_total` (counter), `worker_redeliveries_total` (counter) | Beitrag | sum         | sum         |
| E2E Latency as Queue Pressure Indicator           | `order_e2e_latency_seconds` (histogram)                                                                                                                                                         | Beitrag | sum by (le) | sum by (le) |

### Redis Performance

| Panel                                                   | Metriken                                                                       | Klasse       | vorher | nachher |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------ | ------ | ------- |
| Hit / Miss Ratio [requires redis_exporter]              | `redis_keyspace_hits_total` (counter), `redis_keyspace_misses_total` (counter) | Einzelquelle | keine  | keine   |
| Hits & Misses per Second [requires redis_exporter]      | `redis_keyspace_hits_total` (counter), `redis_keyspace_misses_total` (counter) | Einzelquelle | keine  | keine   |
| Memory Usage [requires redis_exporter]                  | `redis_memory_used_bytes` (gauge)                                              | Einzelquelle | keine  | keine   |
| Key Count & Connected Clients [requires redis_exporter] | `redis_connected_clients` (gauge), `redis_db_keys` (gauge)                     | Einzelquelle | keine  | keine   |

### Inventory Integrity

| Panel                                                                            | Metriken                                                                                                                                                                                                                | Klasse                | vorher                                              | nachher                                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| Reservation Flow (Created / Rollbacks / Compensations)                           | `publish_rollbacks_total` (counter), `reservations_created_total` (counter), `worker_compensations_total` (counter)                                                                                                     | Beitrag               | sum                                                 | sum                                                                  |
| Publish Rollback Rate (5m)                                                       | `publish_rollbacks_total` (counter), `reservations_created_total` (counter)                                                                                                                                             | Beitrag               | sum                                                 | sum                                                                  |
| Worker Compensation Rate (5m)                                                    | `reservations_created_total` (counter), `worker_compensations_total` (counter)                                                                                                                                          | Beitrag               | sum                                                 | sum                                                                  |
| Capacity Delta over time — available + sold + active − capacity **(korrigiert)** | `inventory_capacity_delta_tickets` (gauge)                                                                                                                                                                              | Weltzustand           | keine; –                                            | max by (event_id); min by (event_id)                                 |
| Final Capacity Invariant \|delta\| (after drain = 0) **(korrigiert)**            | `inventory_capacity_delta_tickets` (gauge)                                                                                                                                                                              | Weltzustand           | keine                                               | max by (event_id)                                                    |
| Reservations & Rollbacks by Event                                                | `publish_rollbacks_total` (counter), `reservations_created_total` (counter)                                                                                                                                             | Beitrag               | sum by (event_id)                                   | sum by (event_id)                                                    |
| Reservation Ledger (active / due) **(korrigiert)**                               | `reservation_ledger_active` (gauge), `reservation_ledger_stale` (gauge)                                                                                                                                                 | Weltzustand           | keine                                               | max by (event_id)                                                    |
| Inventory Components (capacity / available / sold / active) **(korrigiert)**     | `inventory_available_tickets` (gauge), `inventory_capacity_tickets` (gauge), `inventory_sold_tickets` (gauge), `reservation_ledger_active` (gauge)                                                                      | Weltzustand           | keine                                               | max by (event_id)                                                    |
| Inventory Auditor Duration                                                       | `inventory_audit_duration_seconds` (histogram)                                                                                                                                                                          | Beitrag               | sum by (le)                                         | sum by (le)                                                          |
| Auditor Freshness **(korrigiert)**                                               | `inventory_audit_last_success_timestamp_seconds` (gauge)                                                                                                                                                                | pro Instanz           | keine                                               | max by (instance)                                                    |
| Oldest Pending Reservation (beyond deadline) **(korrigiert)**                    | `reservation_reaper_oldest_age_seconds` (gauge)                                                                                                                                                                         | Weltzustand           | keine                                               | max by (event_id)                                                    |
| Reaper Activity & Auditor Errors **(korrigiert)**                                | `inventory_audit_runs_total` (counter), `reservation_reaper_candidates` (gauge), `reservation_reaper_errors_total` (counter), `reservation_reaper_releases_total` (counter), `reservation_reaper_skips_total` (counter) | Beitrag + Weltzustand | keine; sum by (event_id); sum by (event_id, reason) | max by (event_id); sum; sum by (event_id); sum by (event_id, reason) |
| Reaper Run Duration (p50 / p95)                                                  | `reservation_reaper_run_duration_seconds` (histogram)                                                                                                                                                                   | Beitrag               | sum by (le)                                         | sum by (le)                                                          |

### Ticket Status

| Panel                                                     | Metriken                                                                                                                                                        | Klasse      | vorher | nachher |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ------- |
| Kapazität **(korrigiert)**                                | `inventory_capacity_tickets` (gauge)                                                                                                                            | Weltzustand | sum    | max     |
| Verfügbar **(korrigiert)**                                | `inventory_available_tickets` (gauge)                                                                                                                           | Weltzustand | sum    | max     |
| Im Checkout gehalten **(korrigiert)**                     | `reservation_ledger_active` (gauge)                                                                                                                             | Weltzustand | sum    | max     |
| Persistiert **(korrigiert)**                              | `inventory_sold_tickets` (gauge)                                                                                                                                | Weltzustand | sum    | max     |
| Ticket-Bestand jetzt (Summe = Kapazität) **(korrigiert)** | `inventory_available_tickets` (gauge), `inventory_sold_tickets` (gauge), `reservation_ledger_active` (gauge)                                                    | Weltzustand | sum    | max     |
| Ticket-Bestand über die Zeit (gestapelt) **(korrigiert)** | `inventory_available_tickets` (gauge), `inventory_sold_tickets` (gauge), `reservation_ledger_active` (gauge)                                                    | Weltzustand | sum    | max     |
| Checkout-Ausgänge (Rate)                                  | `checkouts_cancelled_total` (counter), `payments_confirmed_total` (counter), `payments_rejected_total` (counter), `reservation_reaper_releases_total` (counter) | Beitrag     | sum    | sum     |

### Worker Reliability

| Panel                                                 | Metriken                                                                                                                                                                | Klasse  | vorher            | nachher           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------- | ----------------- |
| Worker Reliability Events (rate per second)           | `worker_compensations_total` (counter), `worker_duplicate_deliveries_total` (counter), `worker_idempotency_hits_total` (counter), `worker_redeliveries_total` (counter) | Beitrag | sum               | sum               |
| Reliability Event Counts (last 5 minutes)             | `worker_compensations_total` (counter), `worker_duplicate_deliveries_total` (counter), `worker_idempotency_hits_total` (counter), `worker_redeliveries_total` (counter) | Beitrag | sum               | sum               |
| Redelivery & Compensation Rate (vs. published orders) | `payments_confirmed_total` (counter), `worker_compensations_total` (counter), `worker_redeliveries_total` (counter)                                                     | Beitrag | sum               | sum               |
| Reliability Events by Event                           | `worker_compensations_total` (counter), `worker_redeliveries_total` (counter)                                                                                           | Beitrag | sum by (event_id) | sum by (event_id) |
| Cumulative Reliability Events (Dashboard Time Range)  | `worker_compensations_total` (counter), `worker_duplicate_deliveries_total` (counter), `worker_idempotency_hits_total` (counter), `worker_redeliveries_total` (counter) | Beitrag | sum               | sum               |
