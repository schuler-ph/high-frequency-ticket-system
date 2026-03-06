import { ticketResetResponseSchema } from "@repo/types/tickets";
import {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";

const ticketBuyRoute: FastifyPluginAsyncZod = async (fastify, _opts) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/buy",
    schema: {
      response: {
        200: ticketResetResponseSchema,
      },
    },
    handler: async (_req, res) => {
      // API dekrementiert Tickets atomar in Redis um Race Conditions zu vermeiden
      await fastify.redis.decr("tickets:available");

      return res.status(200).send({
        message: "ok",
      });
    },
  });
};

export default ticketBuyRoute;
