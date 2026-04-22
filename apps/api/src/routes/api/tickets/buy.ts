import { randomUUID } from "node:crypto";
import { env } from "@repo/env";
import {
  buyTicketBodySchema,
  buyTicketResponseSchema,
  pendingOrderCacheEntrySchema,
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
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";

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
  pendingOrderTtlSeconds?: number;
  createOrderId?: () => string;
};

const rollbackQueuedPurchase = async ({
  redis,
  reservationKey,
  orderCacheKey,
  availabilityKey,
}: {
  redis: TicketRedisClient;
  reservationKey: string;
  orderCacheKey: string;
  availabilityKey: string;
}): Promise<unknown[]> => {
  const cleanupErrors: unknown[] = [];

  try {
    await redis.del(reservationKey);
  } catch (error) {
    cleanupErrors.push(error);
  }

  try {
    await redis.incr(availabilityKey);
  } catch (error) {
    cleanupErrors.push(error);
  }

  try {
    await redis.del(orderCacheKey);
  } catch (error) {
    cleanupErrors.push(error);
  }

  return cleanupErrors;
};

export async function queueBuyTicketPurchase({
  eventId,
  body,
  redis,
  pubsubPublisher,
  reservationTtlSeconds = env.REDIS_RESERVATION_TTL_SECONDS,
  pendingOrderTtlSeconds = env.REDIS_PENDING_ORDER_TTL_SECONDS,
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
  const orderCacheKey = orderRedisKeys.entry(orderId);
  const orderCacheValue = JSON.stringify(
    pendingOrderCacheEntrySchema.parse({
      orderId,
      eventId,
      status: "pending",
    }),
  );

  try {
    await redis.set(reservationKey, orderId, "EX", reservationTtlSeconds);
    await redis.set(
      orderCacheKey,
      orderCacheValue,
      "EX",
      pendingOrderTtlSeconds,
    );

    await pubsubPublisher.publishBuyTicket({
      orderId,
      eventId,
      ...body,
    });
  } catch (error) {
    const cleanupErrors = await rollbackQueuedPurchase({
      redis,
      reservationKey,
      orderCacheKey,
      availabilityKey: keys.available,
    });

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Failed to queue ticket purchase and fully roll back reservation",
      );
    }

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
