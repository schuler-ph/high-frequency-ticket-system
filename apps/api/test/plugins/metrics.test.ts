import * as assert from "node:assert";
import { test } from "node:test";
import { apiRegistry } from "../../src/lib/metrics.ts";
// Registriert die prom-client-Defaults und entfernt den Event-Loop-Lag wieder.
import "../../src/plugins/metrics.ts";

// Gegenstueck zum Worker-Test; Begruendung in ADR-026 (Nachtrag 2026-08-25).
void test("the api registry exposes no nodejs_eventloop_lag metrics", async () => {
  const names = apiRegistry.getMetricsAsArray().map((m) => m.name);
  assert.equal(
    names.some((name) => name.startsWith("nodejs_eventloop_lag")),
    false,
  );
  assert.ok(names.includes("process_cpu_seconds_total"));
  assert.doesNotMatch(await apiRegistry.metrics(), /nodejs_eventloop_lag/);
});
