import { Counter, Registry } from "prom-client";

export const apiRegistry = new Registry();

export const ordersAcceptedTotal = new Counter({
  name: "orders_accepted_total",
  help: "Ticket purchase orders accepted (HTTP 202)",
  labelNames: ["event_id"] as const,
  registers: [apiRegistry],
});

export const reservationsCreatedTotal = new Counter({
  name: "reservations_created_total",
  help: "Ticket reservations atomically created in Redis",
  labelNames: ["event_id"] as const,
  registers: [apiRegistry],
});

export const publishRollbacksTotal = new Counter({
  name: "publish_rollbacks_total",
  help: "Reservations rolled back due to Pub/Sub publish failure",
  labelNames: ["event_id"] as const,
  registers: [apiRegistry],
});
