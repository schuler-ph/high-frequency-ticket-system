# Phase 4.1: Monitoring & Observability

Abgeschlossene Detailnotiz zur Observability-Arbeit aus Phase 4.1. Der aktuelle Systemstand steht in [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md).

### Dashboard-PromQL gegen fehlende Zero-Serien

> - [x] Korrigiere Dashboard-PromQL fuer fehlende Zero-Serien (`or vector(0)`), damit Pending/Queue/Error/Failure/Reliability bei null Fehlern nicht als `No data` verschwinden. — Jeder potenziell fehlende Serien-Operand (failed/5xx/409/rollbacks/compensations/redeliveries/idempotency) in Order-Lifecycle-, Pub/Sub-Queue-, API-Performance-, Worker-Reliability- und Reservation-Consistency-Dashboards mit `or vector(0)` umschlossen; Subtraktions-/Divisions-Ausdruecke operandenweise zero-gefuellt, damit gesundes Null sichtbar bleibt statt zu kollabieren.

### E2E-Latenz-Buckets und Throughput-Panel

> - [x] Erweitere `order_e2e_latency_seconds` ueber den 30-s-Bucket hinaus und benenne die rollende Completion-Rate als Throughput-Verhaeltnis; entferne die irrefuehrende Legendensumme der kumulativen Counts. — Buckets auf `[…,30,60,120,180,300,450,600]` erweitert (Baseline A ~406 s klippte bei 30 s); Panel „Completion Rate (5m)“ → „Worker/API Throughput Ratio (5m)“ (kein `max:1`-Clip mehr, Schwellen < 1 / ≥ 1); Legenden-`sum` auf den kumulativen Order-Lifecycle-/Worker-Reliability-Panels durch `last` ersetzt (ADR-023-Nachtrag).

### redis_exporter und DB-/Runtime-Bottleneck-Metriken

> - [x] Fuege `redis_exporter` sowie CPU/Event-Loop-, PostgreSQL-Pool-Wait-, Query-Latency- und Lock-Wait-Metriken fuer belastbare Bottleneck-Zuordnung hinzu. — `redis_exporter`-Container + Prometheus-Job; Worker exponiert `db_pool_connections` (inkl. Pool-Wait via `waiting`), `db_query_duration_seconds` (Timing am DI-Seam, nicht via `pool.query`-Patch) und `db_locks_waiting` (Sampler aus `pg_stat_activity`); CPU/Event-Loop kamen bereits aus `collectDefaultMetrics` und sind jetzt im neuen Dashboard „DB & Runtime“ sichtbar. Ende-zu-Ende gegen die laufende Infra verifiziert (ADR-026).

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

- [x] Integriere `prom-client` in `apps/api` und Worker für Custom-Metriken (Counter, Histogram).
- [x] Exponiere `/metrics` Endpunkt für Prometheus-Scraping (API & Worker).
- [x] Messe E2E-Latenz von `POST /buy` bis `order completed|failed` als Prometheus-Histogram (`order_e2e_latency_seconds`, Labels: `event_id`, `status`).
- [x] Füge Grafana + Prometheus Services zur `docker-compose.yml` hinzu.
- [x] Konfiguriere Prometheus Target Scraping (für API & Worker Container).
- [x] Erstelle Grafana-Dashboard: API Performance (Latenz, RPS, Error-Rate).
- [x] Erstelle Grafana-Dashboard: Order Lifecycle (`accepted`, `pending`, `completed`, `failed`, Completion-Rate).
- [x] Erstelle Grafana-Dashboard: Order Completion Latency (`buy accepted` → `completed|failed`, p50/p95/p99).
- [x] Erstelle Grafana-Dashboard: Redis Performance (Hit/Miss Ratio) — `redis_exporter` (`hts-redis-exporter`, Host-Port 10009) + Prometheus-Job `redis` ergänzt; Panels sind nicht mehr Placeholder (ADR-026).
- [x] Erstelle Grafana-Dashboard: Pub/Sub Queue Depth & Worker Processing Rate — Worker-Proxy-Panels implementiert; vollständige Queue-Tiefe erfordert Stackdriver-Exporter (GCP) oder pubsub_exporter.
- [x] Erstelle Grafana-Dashboard: Worker Reliability (Redeliveries, Idempotenz-Hits, Processing-Lock-Konflikte, Kompensationen).
- [x] Erstelle Grafana-Dashboard: Reservation & Consistency (aktive Reservations, Publish-Rollbacks, Redis-DB-Drift).
- [x] Konfiguriere k6 Output zur Speicherung in Prometheus/Grafana für Live-Views (`pnpm spike` nutzt `experimental-prometheus-rw`).
- [x] **Dashboard-PromQL gegen fehlende Zero-Serien haerten:** jeder potenziell fehlende Operand mit `or vector(0)` umschlossen, damit gesundes Null nicht als `No data` verschwindet.
- [x] **E2E-Latenz und Throughput-Panel korrigieren:** Buckets bis 600 s, ehrliche Ratio-Bezeichnung und `last` statt Legendensumme. → ADR-023
- [x] **`redis_exporter` + DB-/Runtime-Bottleneck-Metriken:** Pool-Wait, Query-Latency und Lock-Wait aus dem Worker, sichtbar im Dashboard „DB & Runtime“. → ADR-026
