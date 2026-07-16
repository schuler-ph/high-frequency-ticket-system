import { pool } from "@repo/db";
import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const workerRegistry = new Registry();

export const ordersCompletedTotal = new Counter({
  name: "orders_completed_total",
  help: "Ticket orders successfully completed by the worker",
  labelNames: ["event_id"] as const,
  registers: [workerRegistry],
});

export const ordersFailedTotal = new Counter({
  name: "orders_failed_total",
  help: "Ticket orders that reached a terminal failure state",
  labelNames: ["event_id"] as const,
  registers: [workerRegistry],
});

export const workerCompensationsTotal = new Counter({
  name: "worker_compensations_total",
  help: "Reservation compensations performed after terminal worker errors",
  labelNames: ["event_id"] as const,
  registers: [workerRegistry],
});

export const workerRedeliveriesTotal = new Counter({
  name: "worker_redeliveries_total",
  help: "Messages nacked by the worker for redelivery (transient errors or lock conflicts)",
  labelNames: ["event_id"] as const,
  registers: [workerRegistry],
});

export const workerIdempotencyHitsTotal = new Counter({
  name: "worker_idempotency_hits_total",
  help: "Messages skipped because the order was already processed (idempotency short-circuit)",
  labelNames: ["event_id"] as const,
  registers: [workerRegistry],
});

export const redisDbDriftTickets = new Gauge({
  name: "redis_db_drift_tickets",
  help: "Redis available counter minus DB-computed availability per event (0 = consistent)",
  labelNames: ["event_id"] as const,
  registers: [workerRegistry],
});

export const reservationLedgerActive = new Gauge({
  name: "reservation_ledger_active",
  help: "Accepted-but-not-finalized reservations per event, counted from the ZSet ledger (active inventory claims)",
  labelNames: ["event_id"] as const,
  registers: [workerRegistry],
});

export const reservationLedgerStale = new Gauge({
  name: "reservation_ledger_stale",
  help: "Ledger reservations older than the stale threshold per event — reaper candidates, never auto-released",
  labelNames: ["event_id"] as const,
  registers: [workerRegistry],
});

export const orderE2eLatencySeconds = new Histogram({
  name: "order_e2e_latency_seconds",
  help: "End-to-end latency from POST /buy accepted to order completed or failed",
  labelNames: ["event_id", "status"] as const,
  // Baseline A's mean E2E latency was ~406s, which fell entirely into the +Inf
  // overflow bucket at the old 30s cap and clipped p95/p99 flat. Buckets extend
  // to 600s so queue-pressure latency past 30s is actually resolvable.
  buckets: [0.5, 1, 1.5, 2, 2.5, 3, 5, 10, 30, 60, 120, 180, 300, 450, 600],
  registers: [workerRegistry],
});

// --- PostgreSQL bottleneck metrics (ADR-026) ---
// Baseline A hit the flow-control ceiling before proving the DB as a limiter.
// These make pool saturation, query latency, and lock contention observable so
// the next run can attribute bottlenecks instead of guessing.

// node-postgres pool state, sampled on each Prometheus scrape via `collect`.
// `waiting` > 0 means requests are queued for a connection — the pool-wait
// backpressure signal that pairs with DATABASE_POOL_MAX / flow control.
export const dbPoolConnections = new Gauge({
  name: "db_pool_connections",
  help: "node-postgres pool connections by state (total = open, idle = free, waiting = queued acquirers)",
  labelNames: ["state"] as const,
  registers: [workerRegistry],
  collect() {
    this.set({ state: "total" }, pool.totalCount);
    this.set({ state: "idle" }, pool.idleCount);
    this.set({ state: "waiting" }, pool.waitingCount);
  },
});

export const dbQueryDurationSeconds = new Histogram({
  name: "db_query_duration_seconds",
  help: "Latency of worker PostgreSQL operations by logical query name",
  labelNames: ["query"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [workerRegistry],
});

// Backends currently blocked waiting on a lock (hot-row contention indicator).
// Sampled by the db-metrics plugin, not on scrape, because it costs a query.
export const dbLocksWaiting = new Gauge({
  name: "db_locks_waiting",
  help: "PostgreSQL backends currently waiting to acquire a lock (pg_stat_activity wait_event_type = 'Lock')",
  registers: [workerRegistry],
});

/**
 * Times a worker DB operation into `db_query_duration_seconds{query}`. Wraps at
 * the composition root (pubsub-listener deps) so `@repo/db` stays free of
 * metrics coupling and `pool.query` is never monkey-patched.
 */
export async function timeDbQuery<T>(
  query: string,
  run: () => Promise<T>,
): Promise<T> {
  const end = dbQueryDurationSeconds.startTimer({ query });
  try {
    return await run();
  } finally {
    end();
  }
}
