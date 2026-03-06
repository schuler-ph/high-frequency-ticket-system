import { randomUUID } from "node:crypto";
import {
  buyTicketRequestSchema,
  buyTicketResponseSchema,
} from "@repo/types/tickets";
import { ConflictError } from "@repo/types/errors";
import {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";

type TicketRedisClient = {
  decr: (key: string) => Promise<number>;
  incr: (key: string) => Promise<number>;
};

type TicketPublisher = {
  publishBuyTicket: (payload: unknown) => Promise<string>;
};

const ticketBuyRoute: FastifyPluginAsyncZod = async (fastify, _opts) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/buy",
    schema: {
      body: buyTicketRequestSchema,
      response: {
        202: buyTicketResponseSchema,
      },
    },
    handler: async (req, res) => {
      const { redis, pubsubPublisher } = fastify as typeof fastify & {
        redis: TicketRedisClient;
        pubsubPublisher: TicketPublisher;
      };

      // Redis DECR is atomic; negative values mean sold-out and are compensated.
      const availableAfterReserve = await redis.decr("tickets:available");

      if (availableAfterReserve < 0) {
        await redis.incr("tickets:available");
        throw new ConflictError("Tickets sold out");
      }

      const orderId = randomUUID();

      try {
        await pubsubPublisher.publishBuyTicket({
          orderId,
          ...req.body,
        });
      } catch (error) {
        // Rollback the reservation when publish fails.
        await redis.incr("tickets:available");
        throw error;
      }

      return res.status(202).send({
        message: "Ticket purchase queued",
        orderId,
      });
    },
  });
};

export default ticketBuyRoute;
