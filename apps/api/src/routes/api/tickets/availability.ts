import {
  ticketAvailabilityResponseSchema,
  ticketEventIdSchema,
} from "@repo/types/tickets";
import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ticketRedisKeys } from "@repo/types/redis-keys";

const parseRedisCount = (value: string | null | undefined): number | null => {
  if (value == null) {
    return null;
  }

  const parsedValue = Number(value);

  if (!Number.isSafeInteger(parsedValue)) {
    throw new Error(`Invalid Redis counter value: ${value}`);
  }

  return parsedValue;
};

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
        available: parseRedisCount(availableStr),
        total: parseRedisCount(totalStr),
      });
    },
  });
};

export default ticketAvailabilityRoute;
