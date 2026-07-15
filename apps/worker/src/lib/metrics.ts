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
  buckets: [0.5, 1, 1.5, 2, 2.5, 3, 5, 10, 30],
  registers: [workerRegistry],
});
