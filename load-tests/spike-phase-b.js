import {
  SYSTEM_TAGS,
  requireEnvNumber,
  ticketSaleIteration,
} from "./lib/scenario-helpers.js";

// Lastform als Profil-Knoepfe (ADR-034: kein Skript-Default), siehe
// spike-phase-a.js.
const COOLDOWN_RATE = requireEnvNumber("K6_COOLDOWN_RATE");
const COOLDOWN_MAX_VUS = requireEnvNumber("K6_COOLDOWN_MAX_VUS");

export const options = {
  // Ohne `url` (und mit statischen `name`-Tags in den Helpers), sonst
  // erzeugt jede orderId eine eigene Zeitreihe — siehe SYSTEM_TAGS.
  systemTags: SYSTEM_TAGS,
  scenarios: {
    cool_down: {
      // Phase 4 – Cool-Down: K6_COOLDOWN_RATE RPS flat, 1 Minute. Wird von
      // der Orchestrierung direkt im Anschluss an den reaktiv gestoppten
      // Sold-Out von Phase A gestartet.
      executor: "constant-arrival-rate",
      rate: COOLDOWN_RATE,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 200,
      maxVUs: COOLDOWN_MAX_VUS,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.05"],
    // Export-Mechanismus wie in spike-phase-a.js: materialisiert die
    // endpoint-Sub-Metriken im `--summary-export`, gate-t nichts.
    "transport_errors{endpoint:availability}": ["count>=0"],
    "transport_errors{endpoint:buy}": ["count>=0"],
    "transport_errors{endpoint:pay}": ["count>=0"],
    "transport_errors{endpoint:cancel}": ["count>=0"],
    "transport_errors{endpoint:orders}": ["count>=0"],
  },
};

export default ticketSaleIteration;
