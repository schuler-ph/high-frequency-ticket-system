import * as assert from "node:assert";
import { test } from "node:test";
import { workerRegistry } from "../../src/lib/metrics.ts";
// Registriert die prom-client-Defaults und entfernt den Event-Loop-Lag wieder.
import "../../src/plugins/metrics.ts";

// ADR-026 Nachtrag: die Event-Loop-Lag-Defaults massen mit 10-ms-Aufloesung
// und Reset je Collect nichts Verwertbares und wurden als Entlastungsbeweis
// gelesen. Sie fehlen absichtlich — dieser Test haelt das fest, damit ein
// prom-client-Update sie nicht still zurueckbringt.
void test("the worker registry exposes no nodejs_eventloop_lag metrics", async () => {
  const names = workerRegistry.getMetricsAsArray().map((m) => m.name);
  assert.equal(
    names.some((name) => name.startsWith("nodejs_eventloop_lag")),
    false,
    `unexpected event-loop metrics: ${names.filter((n) => n.startsWith("nodejs_eventloop_lag")).join(", ")}`,
  );
  // Die uebrigen Defaults (CPU, Speicher) bleiben — nur der Lag ist weg.
  assert.ok(names.includes("process_cpu_seconds_total"));
  assert.doesNotMatch(await workerRegistry.metrics(), /nodejs_eventloop_lag/);
});
