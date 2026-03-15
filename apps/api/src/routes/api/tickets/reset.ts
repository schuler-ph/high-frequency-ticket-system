import {
  ticketEventIdSchema,
  ticketResetResponseSchema,
} from "@repo/types/tickets";
import {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ticketRedisKeys } from "@repo/types/redis-keys";

const INITIAL_TICKET_CAPACITY = "1000000";

const ticketResetRoute: FastifyPluginAsyncZod = async (fastify, _opts) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:eventId/reset",
    schema: {
      params: ticketEventIdSchema,
      response: {
        200: ticketResetResponseSchema,
      },
    },
    handler: async (req, res) => {
      const keys = ticketRedisKeys(req.params.eventId);

      await fastify.redis.mset({
        [keys.total]: INITIAL_TICKET_CAPACITY,
        [keys.available]: INITIAL_TICKET_CAPACITY,
      });

      return res.status(200).send({
        message: "Tickets reset successfully",
      });
    },
  });
};

export default ticketResetRoute;
