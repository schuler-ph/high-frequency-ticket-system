import { randomUUID } from "node:crypto";
import { env } from "@repo/env";
import {
  buyTicketBodySchema,
  buyTicketResponseSchema,
  ticketEventIdSchema,
  type BuyTicketEvent,
} from "@repo/types/tickets";
import { ConflictError } from "@repo/types/errors";
import {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ticketRedisKeys } from "@repo/types/redis-keys";

const ATOMIC_RESERVE_TICKET_SCRIPT = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current <= 0 then
  return -1
end

return redis.call("DECR", KEYS[1])
`;

type TicketRedisClient = {
  eval: (
    script: string,
    numKeys: number,
    ...args: string[]
  ) => Promise<number | string>;
  set: (
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ) => Promise<"OK" | null>;
  del: (key: string) => Promise<number>;
  incr: (key: string) => Promise<number>;
};

type TicketPublisher = {
  publishBuyTicket: (payload: BuyTicketEvent) => Promise<string>;
};

const ticketBuyRoute: FastifyPluginAsyncZod = async (fastify, _opts) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:eventId/buy",
    schema: {
      params: ticketEventIdSchema,
      body: buyTicketBodySchema,
      response: {
        202: buyTicketResponseSchema,
      },
    },
    handler: async (req, res) => {
      const { redis, pubsubPublisher } = fastify as typeof fastify & {
        redis: TicketRedisClient;
        pubsubPublisher: TicketPublisher;
      };
      const keys = ticketRedisKeys(req.params.eventId);

      const reserveResult = await redis.eval(
        ATOMIC_RESERVE_TICKET_SCRIPT,
        1,
        keys.available,
      );
      const availableAfterReserve = Number(reserveResult);

      if (availableAfterReserve < 0) {
        throw new ConflictError("Tickets sold out");
      }

      const orderId = randomUUID();
      const reservationKey = keys.reservation(orderId);

      try {
        await redis.set(
          reservationKey,
          orderId,
          "EX",
          env.REDIS_RESERVATION_TTL_SECONDS,
        );

        await pubsubPublisher.publishBuyTicket({
          orderId,
          eventId: req.params.eventId,
          ...req.body,
        });
      } catch (error) {
        await redis.del(reservationKey);
        await redis.incr(keys.available);
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
