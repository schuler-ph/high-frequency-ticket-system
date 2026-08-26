import fp from "fastify-plugin";
import promClient from "prom-client";
import { workerRegistry } from "../lib/metrics.ts";

const { collectDefaultMetrics, contentType } = promClient;

collectDefaultMetrics({ register: workerRegistry });

// Die Event-Loop-Lag-Defaults sind fuer diesen Zweck tot (ADR-026 Nachtrag):
// 10-ms-Aufloesung, deren Boden die Abtastperiode selbst ist, und ein
// Histogramm-Reset in jedem Collect — Baseline E zeigte vor wie nach dem Lauf
// ~11 ms, egal was das System tat. Eine tote Metrik ist schlimmer als keine,
// weil sie als Entlastungsbeweis gelesen wird. prom-client kennt keine
// Auswahl einzelner Default-Metriken, deshalb nachtraeglich entfernen.
for (const metric of workerRegistry.getMetricsAsArray()) {
  if (metric.name.startsWith("nodejs_eventloop_lag")) {
    workerRegistry.removeSingleMetric(metric.name);
  }
}

export default fp(async (fastify) => {
  fastify.route({
    method: "GET",
    url: "/metrics",
    handler: async (_req, reply) => {
      reply.header("Content-Type", contentType);
      return reply.send(await workerRegistry.metrics());
    },
  });
});
