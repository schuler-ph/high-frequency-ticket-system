import fp from "fastify-plugin";
import promClient from "prom-client";
import { workerRegistry } from "../lib/metrics.ts";

const { collectDefaultMetrics, contentType } = promClient;

collectDefaultMetrics({ register: workerRegistry });

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
