import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { healthSchema } from "@repo/types/health";
// Zieht die `serviceHealth`-Deklaration aus dem Plugin in diesen Typgraphen.
// Das Gegenstueck zur Laufzeit-Abhaengigkeit `dependencies: ["service-health"]`.
import type {} from "../plugins/service-health.ts";

/**
 * Liveness-Endpunkt. Antwortet 503, sobald der Prozess dauerhaft
 * arbeitsunfaehig ist (ADR-044) — in Kubernetes loest die Liveness-Probe damit
 * den Neustart aus, der die einzige Reparatur ist. Ohne das meldet ein Pod
 * gruen, waehrend er nichts verarbeitet.
 */
const healthRoutes: FastifyPluginAsyncZod = async (fastify, _opts) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/health",
    schema: healthSchema,
    handler: async (_req, res) => {
      const { fatalReason } = fastify.serviceHealth;

      if (fatalReason !== null) {
        return res.status(503).send({
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          reason: fatalReason,
        });
      }

      return res.status(200).send({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    },
  });
};

export default healthRoutes;
