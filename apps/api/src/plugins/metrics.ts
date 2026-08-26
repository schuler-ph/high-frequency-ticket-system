import fp from "fastify-plugin";
import promClient from "prom-client";
import { apiRegistry, httpRequestDurationSeconds } from "../lib/metrics.ts";

const { collectDefaultMetrics, contentType } = promClient;

collectDefaultMetrics({ register: apiRegistry });

// Event-Loop-Lag-Defaults entfernt — Begruendung im Worker-Gegenstueck
// (apps/worker/src/plugins/metrics.ts) und ADR-026 Nachtrag.
for (const metric of apiRegistry.getMetricsAsArray()) {
  if (metric.name.startsWith("nodejs_eventloop_lag")) {
    apiRegistry.removeSingleMetric(metric.name);
  }
}

export default fp(async (fastify) => {
  fastify.addHook("onResponse", (request, reply, done) => {
    httpRequestDurationSeconds.observe(
      {
        method: request.method,
        route: request.routeOptions.url ?? request.url,
        status_code: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
    done();
  });

  fastify.route({
    method: "GET",
    url: "/metrics",
    handler: async (_req, reply) => {
      reply.header("Content-Type", contentType);
      return reply.send(await apiRegistry.metrics());
    },
  });
});
