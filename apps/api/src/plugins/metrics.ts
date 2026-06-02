import fp from "fastify-plugin";
import promClient from "prom-client";
import {
  apiRegistry,
  httpRequestDurationSeconds,
} from "../lib/metrics.ts";

const { collectDefaultMetrics, contentType } = promClient;

collectDefaultMetrics({ register: apiRegistry });

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
