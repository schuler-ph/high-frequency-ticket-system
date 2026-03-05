import {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { healthSchema } from "@repo/types/health";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsyncZod requires async signature
const healthRoutes: FastifyPluginAsyncZod = async (fastify, _opts) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/health",
    schema: healthSchema,
    handler: async (_req, res) => {
      return res.status(200).send({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    },
  });
};

export default healthRoutes;
