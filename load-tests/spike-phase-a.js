import {
  SYSTEM_TAGS,
  requireEnvNumber,
  ticketSaleIteration,
} from "./lib/scenario-helpers.js";

// Lastform als Profil-Knoepfe (ADR-034: kein Skript-Default). Die Werte stehen
// je Profil in packages/env/profiles/<profil>.env und landen im Report-Manifest, damit ein
// Lauf im Nachhinein rekonstruierbar bleibt. Ein verteilter Generator (Phase
// 5.7) teilt die Zielrate ueber Shards auf — mit hartkodierten Groessen ginge
// das nicht.
// Warm-up-Rate ist ein Profilwert, seit das Smoke-Profil (1k Tickets, 50 it/s)
// nicht mit 1.000 RPS vorglühen soll; die Kapazitätsprofile setzen 1000.
const WARMUP_RATE = requireEnvNumber("K6_WARMUP_RATE");
const TARGET_RATE = requireEnvNumber("K6_TARGET_RATE");
const MAX_VUS = requireEnvNumber("K6_MAX_VUS");
// Vorallokierte VUs. Achtung, zwei Fehlannahmen aus Baseline F: (1) k6 oeffnet
// Verbindungen erst bei der ersten Anfrage eines VUs — im 1.000-RPS-Warm-up
// sind nur ~50 VUs aktiv, die uebrigen bleiben unverbunden, es "waermt" also
// nichts vor. (2) Gegen einen gesaettigten Server (API auf einem Core) ist
// mehr verfuegbare Concurrency schaedlich: Runde 2 mit 8.000 statt 200 trieb
// alle 16.000 VUs in den Einsatz und p95 von 228 auf 1.667 ms, Drops von 0,36
// auf 4,28 %. Der Knopf bleibt fuer Profile unterhalb der Decke sinnvoll.
const PREALLOCATED_VUS = requireEnvNumber("K6_PREALLOCATED_VUS");

export const options = {
  // Ohne `url` (und mit statischen `name`-Tags in den Helpers), sonst
  // erzeugt jede orderId eine eigene Zeitreihe — siehe SYSTEM_TAGS.
  systemTags: SYSTEM_TAGS,
  scenarios: {
    warmup_ramp_sustain: {
      executor: "ramping-arrival-rate",
      // Flat K6_WARMUP_RATE for the first stage (startRate == first target).
      startRate: WARMUP_RATE,
      timeUnit: "1s",
      preAllocatedVUs: PREALLOCATED_VUS,
      // VU-Budget muss die Zielrate auch bei steigender Latenz decken:
      // benoetigte VUs = Rate x Iterationsdauer. Reicht es nicht, verwirft k6
      // Iterationen (dropped) und der Lauf ist als Kapazitaetsnachweis
      // ungueltig — Baseline C (5.000 VUs, p95 ~874 ms im Crunch): 21,85 %
      // dropped; Baseline E (10.000 VUs, p95-Iteration 1,25 s): 5,2 %. Die
      // Herleitung je Profil steht in docs/notes/backlogs/baseline-f-valid-runs.md.
      maxVUs: MAX_VUS,
      stages: [
        // Phase 1 – Warm-Up:  K6_WARMUP_RATE flat, 45s (Pre-Sale-Hype, Sale
        // ist noch gesperrt — Kaufversuche liefern 425 bis `opensAt` erreicht ist)
        { target: WARMUP_RATE, duration: "45s" },
        // Phase 2 – Ramp-Up:  K6_WARMUP_RATE → K6_TARGET_RATE RPS, 45s (Sale-Opening
        // naehert sich; `opensAt` liegt typischerweise in diesem Fenster)
        { target: TARGET_RATE, duration: "45s" },
        // Phase 3 – Sustain:  K6_TARGET_RATE RPS, 15 Minuten Sicherheitsnetz.
        // Die Orchestrierung (scripts/load-test/run-and-report.mjs) pollt die
        // Verfuegbarkeit und stoppt diese Stage reaktiv (SIGINT lokal, REST
        // remote), sobald `available` auf 0 faellt — die 15 Minuten greifen
        // nur, falls kein Sold-Out erkannt wird (z.B. bei einem manuellen
        // `k6 run` ohne Orchestrator).
        { target: TARGET_RATE, duration: "15m" },
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
