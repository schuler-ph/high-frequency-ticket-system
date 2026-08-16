import { env } from "@repo/env";
import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const apiRegistry = new Registry();

/**
 * Prometheus-Info-Metrik: die **effektiv laufende** Konfiguration dieses
 * Prozesses als Labels, Wert immer 1.
 *
 * Grund (Baseline B, Report §2): Der Report-Collector snapshottete die
 * Konfiguration aus `process.env` des **Orchestrators** und wies deshalb
 * `NODE_ENV=test` aus, obwohl API und Worker via `start:loadtest` mit
 * `NODE_ENV=production` liefen — die dokumentierte Messkonfiguration war also
 * irrefuehrend. Da der Collector `/metrics` ohnehin vor und nach dem Lauf
 * abzieht, ist der Service selbst die verlaessliche Quelle.
 */
export const serviceConfigInfo = new Gauge({
  name: "service_config_info",
  help: "Effective runtime configuration of this service (labels carry the values, value is always 1)",
  labelNames: [
    "service",
    "node_env",
    "log_level",
    "disable_request_logging",
  ] as const,
  registers: [apiRegistry],
});

serviceConfigInfo.set(
  {
    service: "api",
    node_env: env.NODE_ENV,
    log_level: env.LOG_LEVEL,
    disable_request_logging: String(env.DISABLE_REQUEST_LOGGING),
  },
  1,
);

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

// Checkout-Funnel: abgelehnte Zahlversuche. Bisher waren Ablehnungen nur als
// Statuscode im HTTP-Histogramm sichtbar und damit nicht nach Ursache trennbar.
// `expired` ist die Serie, die belegt, dass der Ablauf-Pfad unter Last wirklich
// ausgeuebt wurde (ADR-033). `event_id` ist bei `not-found` unbekannt, weil es
// dann keinen Record mehr gibt, aus dem es zu lesen waere.
export const paymentsRejectedTotal = new Counter({
  name: "payments_rejected_total",
  help: "Payment attempts rejected, by reason (expired, not-found, conflict)",
  labelNames: ["event_id", "reason"] as const,
  registers: [apiRegistry],
});

// Checkout-Funnel: abgebrochene Checkouts (POST /orders/:orderId/cancel), die
// eine aktive Reservierung freigegeben haben. Abandon-Rate per PromQL aus
// reservations_created - payments_confirmed ableitbar (ADR-028).
export const checkoutsCancelledTotal = new Counter({
  name: "checkouts_cancelled_total",
  help: "Checkouts cancelled by the user, releasing an active reservation",
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
