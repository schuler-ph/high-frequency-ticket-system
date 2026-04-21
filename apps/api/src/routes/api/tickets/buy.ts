import { randomUUID } from "node:crypto";
import { env } from "@repo/env";
import {
  buyTicketBodySchema,
  buyTicketResponseSchema,
  ticketEventIdSchema,
  type BuyTicketBody,
  type BuyTicketEvent,
  type BuyTicketResponse,
} from "@repo/types/tickets";
import { ConflictError } from "@repo/types/errors";
import type {
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

type QueueBuyTicketPurchaseInput = {
  eventId: string;
  body: BuyTicketBody;
  redis: TicketRedisClient;
  pubsubPublisher: TicketPublisher;
  reservationTtlSeconds?: number;
  createOrderId?: () => string;
};

export async function queueBuyTicketPurchase({
  eventId,
  body,
  redis,
  pubsubPublisher,
  reservationTtlSeconds = env.REDIS_RESERVATION_TTL_SECONDS,
  createOrderId = randomUUID,
}: QueueBuyTicketPurchaseInput): Promise<BuyTicketResponse> {
  const keys = ticketRedisKeys(eventId);

  const reserveResult = await redis.eval(
    ATOMIC_RESERVE_TICKET_SCRIPT,
    1,
    keys.available,
  );
  const availableAfterReserve = Number(reserveResult);

  if (availableAfterReserve < 0) {
    throw new ConflictError("Tickets sold out");
  }

  const orderId = createOrderId();
  const reservationKey = keys.reservation(orderId);

  try {
    await redis.set(reservationKey, orderId, "EX", reservationTtlSeconds);

    await pubsubPublisher.publishBuyTicket({
      orderId,
      eventId,
      ...body,
    });
  } catch (error) {
    await redis.del(reservationKey);
    await redis.incr(keys.available);
    throw error;
  }

  return {
    message: "Ticket purchase queued",
    orderId,
  };
}

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
      const response = await queueBuyTicketPurchase({
        eventId: req.params.eventId,
        body: req.body,
        redis,
        pubsubPublisher,
      });

      return res.status(202).send(response);
    },
  });
};

export default ticketBuyRoute;
