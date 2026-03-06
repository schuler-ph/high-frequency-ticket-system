import { ticketAvailabilityResponseSchema } from "@repo/types/tickets";
import {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";

const ticketAvailabilityRoute: FastifyPluginAsyncZod = async (
  fastify,
  _opts,
  // eslint-disable-next-line @typescript-eslint/require-await
) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/availability",
    schema: {
      response: {
        200: ticketAvailabilityResponseSchema,
      },
    },
    handler: async (_req, res) => {
      // API liest Ticket-Verfügbarkeiten ausschließlich aus dem Redis-Cache
      const [totalStr, availableStr] = await fastify.redis.mget(
        "tickets:total",
        "tickets:available",
      );

      return res.status(200).send({
        available: availableStr ?? null,
        total: totalStr ?? null,
      });
    },
  });
};

export default ticketAvailabilityRoute;
