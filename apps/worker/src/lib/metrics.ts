import { Counter, Registry } from "prom-client";

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

export const processingLockConflictsTotal = new Counter({
  name: "processing_lock_conflicts_total",
  help: "Messages nacked because the processing lock was already held by another worker",
  labelNames: ["event_id"] as const,
  registers: [workerRegistry],
});
