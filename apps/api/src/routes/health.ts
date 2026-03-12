import {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { healthSchema } from "@repo/types/health";

const healthRoutes: FastifyPluginAsyncZod = async (fastify, _opts) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/health",
    schema: healthSchema,
    handler: async (_req, res) => {
      console.log("Health check endpoint called");
      return res.status(200).send({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    },
  });
};

export default healthRoutes;
