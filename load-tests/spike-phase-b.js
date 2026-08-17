import { ticketSaleIteration } from "./lib/scenario-helpers.js";

export const options = {
  scenarios: {
    cool_down: {
      // Phase 4 – Cool-Down: 1.000 RPS flat, 1 Minute. Wird von der
      // Orchestrierung (scripts/local/run-spike.mjs) direkt im Anschluss an
      // den per SIGINT gestoppten Sold-Out von Phase A gestartet.
      executor: "constant-arrival-rate",
      rate: 1000,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 200,
      maxVUs: 5000,
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
