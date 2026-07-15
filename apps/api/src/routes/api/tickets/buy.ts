import { randomUUID } from "node:crypto";
import { env } from "@repo/env";
import {
  buyTicketBodySchema,
  buyTicketResponseSchema,
  ticketEventIdSchema,
  type BuyTicketBody,
  type BuyTicketEvent,
  type BuyTicketResponse,
  type PendingOrderCacheEntry,
} from "@repo/types/tickets";
import { ConflictError, TooEarlyError } from "@repo/types/errors";
import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import {
  ordersAcceptedTotal,
  publishRollbacksTotal,
  reservationsCreatedTotal,
} from "../../../lib/metrics.ts";
import {
  registerTicketRedisScripts,
  type TicketRedisScripts,
} from "../../../lib/redis-scripts.ts";
import type {} from "@fastify/redis";
import type {} from "../../../plugins/pubsub.ts";

type TicketPublisher = {
  publishBuyTicket: (payload: BuyTicketEvent) => Promise<string>;
};

type QueueBuyTicketPurchaseInput = {
  eventId: string;
  body: BuyTicketBody;
  redis: TicketRedisScripts;
  pubsubPublisher: TicketPublisher;
  pendingOrderTtlSeconds?: number;
  createOrderId?: () => string;
  onReservationCreated?: () => void;
  onPublishRollback?: () => void;
};

export async function queueBuyTicketPurchase({
  eventId,
  body,
  redis,
  pubsubPublisher,
  pendingOrderTtlSeconds = env.REDIS_PENDING_ORDER_TTL_SECONDS,
  createOrderId = randomUUID,
  onReservationCreated,
  onPublishRollback,
}: QueueBuyTicketPurchaseInput): Promise<BuyTicketResponse> {
  const keys = ticketRedisKeys(eventId);
  const orderId = createOrderId();
  const orderCacheKey = orderRedisKeys.entry(orderId);
  const orderCacheValue = JSON.stringify({
    orderId,
    eventId,
    status: "pending",
  } satisfies PendingOrderCacheEntry);
  // Zeitstempel wird dreifach genutzt: Ledger-Score (ZADD), Sale-Unlock-Check
  // (opensAt) und `queuedAt` im Pub/Sub-Payload — ein Date.now() pro Request.
  const now = Date.now();

  const availableAfterReserve = await redis.reserveTicket(
    keys.available,
    keys.reservations,
    orderCacheKey,
    keys.opensAt,
    orderId,
    orderCacheValue,
    pendingOrderTtlSeconds,
    now,
  );

  if (availableAfterReserve === -2) {
    throw new TooEarlyError("Tickets are not yet on sale");
  }

  if (availableAfterReserve < 0) {
    throw new ConflictError("Tickets sold out");
  }

  onReservationCreated?.();

  try {
    await pubsubPublisher.publishBuyTicket({
      orderId,
      eventId,
      queuedAt: now,
      ...body,
    });
  } catch (error) {
    try {
      await redis.releaseTicketReservation(
        keys.reservations,
        keys.available,
        orderCacheKey,
        orderId,
      );
    } catch (releaseError) {
      onPublishRollback?.();
      throw new AggregateError(
        [error, releaseError],
        "Failed to queue ticket purchase and fully roll back reservation",
      );
    }

    onPublishRollback?.();
    throw error;
  }

  return {
    message: "Ticket purchase queued",
    orderId,
  };
}

const ticketBuyRoute: FastifyPluginAsyncZod = async (fastify, _opts) => {
  const redis = registerTicketRedisScripts(fastify.redis);

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
      const { eventId } = req.params;
      const response = await queueBuyTicketPurchase({
        eventId,
        body: req.body,
        redis,
        pubsubPublisher: fastify.pubsubPublisher,
        onReservationCreated: () =>
          reservationsCreatedTotal.inc({ event_id: eventId }),
        onPublishRollback: () =>
          publishRollbacksTotal.inc({ event_id: eventId }),
      });

      ordersAcceptedTotal.inc({ event_id: eventId });
      return res.status(202).send(response);
    },
  });
};

export default ticketBuyRoute;
