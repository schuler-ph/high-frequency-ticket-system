import { ticketSaleIteration } from "./lib/scenario-helpers.js";

export const options = {
  scenarios: {
    warmup_ramp_sustain: {
      executor: "ramping-arrival-rate",
      // Flat 1.000 RPS for the first stage (startRate == first target).
      startRate: 1000,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      // VU-Budget muss die Zielrate auch bei steigender Latenz decken:
      // benoetigte VUs = Rate x Iterationsdauer. Baseline C lief mit 5.000 in
      // den Deckel, als die Latenz im Ausverkaufs-Crunch auf p95 ~874 ms stieg
      // (benoetigt ~8.700) -> 21,85 % dropped iterations, Lauf invalid.
      // 10.000 deckt die 10k-Zielrate bis ~1 s Iterationsdauer.
      maxVUs: 10000,
      stages: [
        // Phase 1 – Warm-Up:  1.000 RPS flat, 45s (Pre-Sale-Hype, Sale ist
        // noch gesperrt — Kaufversuche liefern 425 bis `opensAt` erreicht ist)
        { target: 1000, duration: "45s" },
        // Phase 2 – Ramp-Up:  1.000 → 5.000 RPS, 45s (Sale-Opening naehert
        // sich; `opensAt` liegt typischerweise irgendwo in diesem Fenster)
        { target: 10000, duration: "45s" },
        // Phase 3 – Sustain:  5.000 RPS, 15 Minuten Sicherheitsnetz. Die
        // Orchestrierung (scripts/local/run-spike.mjs) pollt die
        // Verfuegbarkeit und stoppt diese Stage per SIGINT, sobald
        // `available` auf 0 faellt — die 15 Minuten greifen nur, falls kein
        // Sold-Out erkannt wird (z.B. bei einem manuellen `k6 run` ohne
        // Orchestrator).
        { target: 10000, duration: "15m" },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    // 409 (sold-out) und 425 (zu frueh) sind erwartete Responses und werden
    // via responseCallback ausgeschlossen; dieser Threshold greift nur bei
    // echten Infrastruktur-Fehlern.
    http_req_failed: ["rate<0.05"],
    // Reiner Export-Mechanismus, kein Gate: `--summary-export` wirft Tags
    // weg, aber ein Threshold auf dem Tag-Selektor materialisiert die
    // Sub-Metrik als eigenen Summary-Key (`transport_errors{endpoint:buy}`).
    // `count>=0` ist bewusst unverletzbar. Nicht ueber Prometheus-RW loesen —
    // die per-Iteration-Tags haben in Baseline B Prometheus mit 5,5 GiB
    // gekillt (siehe buildK6Args in scripts/load-test/lib/processes.mjs).
    "transport_errors{endpoint:availability}": ["count>=0"],
    "transport_errors{endpoint:buy}": ["count>=0"],
    "transport_errors{endpoint:pay}": ["count>=0"],
    "transport_errors{endpoint:cancel}": ["count>=0"],
    "transport_errors{endpoint:orders}": ["count>=0"],
  },
};

export default ticketSaleIteration;
