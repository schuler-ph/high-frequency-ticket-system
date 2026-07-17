import { Counter, Histogram, Registry } from "prom-client";

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
  help: "Reservations rolled back due to Pub/Sub publish failure (pay route)",
  labelNames: ["event_id"] as const,
  registers: [apiRegistry],
});

// Checkout-Funnel: bestaetigte Zahlungen (POST /orders/:orderId/pay). Zusammen
// mit reservations_created (Buy) und checkouts_cancelled (Cancel) macht das die
// Abandon-Rate des Checkouts per PromQL ableitbar (ADR-028).
export const paymentsConfirmedTotal = new Counter({
  name: "payments_confirmed_total",
  help: "Simulated payments confirmed and BuyTicketEvent published (HTTP 200)",
  labelNames: ["event_id"] as const,
  registers: [apiRegistry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [apiRegistry],
});
