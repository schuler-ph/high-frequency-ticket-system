import { ticketResetResponseSchema } from "@repo/types/tickets";
import {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";

const ticketResetRoute: FastifyPluginAsyncZod = async (fastify, _opts) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/reset",
    schema: {
      response: {
        200: ticketResetResponseSchema,
      },
    },
    handler: async (_req, res) => {
      await fastify.redis.mset({
        "tickets:total": "1000000",
        "tickets:available": "1000000",
      });

      return res.status(200).send({
        message: "Tickets reset successfully",
      });
    },
  });
};

export default ticketResetRoute;
