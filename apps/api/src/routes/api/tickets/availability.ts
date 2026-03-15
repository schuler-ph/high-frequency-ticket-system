import {
  ticketAvailabilityResponseSchema,
  ticketEventIdSchema,
} from "@repo/types/tickets";
import {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ticketRedisKeys } from "../../../lib/redis-keys.js";

const ticketAvailabilityRoute: FastifyPluginAsyncZod = async (
  fastify,
  _opts,
) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/:eventId/availability",
    schema: {
      params: ticketEventIdSchema,
      response: {
        200: ticketAvailabilityResponseSchema,
      },
    },
    handler: async (req, res) => {
      const keys = ticketRedisKeys(req.params.eventId);

      // API liest Ticket-Verfügbarkeiten ausschließlich aus dem Redis-Cache
      const [totalStr, availableStr] = await fastify.redis.mget(
        keys.total,
        keys.available,
      );

      return res.status(200).send({
        available: availableStr ?? null,
        total: totalStr ?? null,
      });
    },
  });
};

export default ticketAvailabilityRoute;
