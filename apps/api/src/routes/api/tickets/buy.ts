import { randomUUID } from "node:crypto";
import { env } from "@repo/env";
import {
  buyTicketBodySchema,
  buyTicketResponseSchema,
  conflictErrorResponseSchema,
  ticketEventIdSchema,
  tooEarlyErrorResponseSchema,
  type BuyTicketBody,
  type BuyTicketResponse,
  type PendingOrderReservation,
} from "@repo/types/tickets";
import { ConflictError, TooEarlyError } from "@repo/types/errors";
import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import {
  ordersAcceptedTotal,
  reservationsCreatedTotal,
} from "../../../lib/metrics.ts";
import {
  registerTicketRedisScripts,
  type TicketRedisScripts,
} from "../../../lib/redis-scripts.ts";
import type {} from "@fastify/redis";

type QueueBuyTicketPurchaseInput = {
  eventId: string;
  body: BuyTicketBody;
  redis: TicketRedisScripts;
  pendingOrderTtlSeconds?: number;
  createOrderId?: () => string;
  onReservationCreated?: () => void;
};

/**
 * Reserviert ein Ticket atomar in Redis (Lua: Sale-Unlock-Check + `DECR
 * available` + Ledger-`ZADD` + Pending-Order) und liefert `orderId` + `202`.
 *
 * Nach dem Reserve/Pay-Split (ADR-028) published der Buy **nicht** mehr an
 * Pub/Sub — der Ticket-Anspruch ist waehrend des Checkouts nur reserviert. Erst
 * `POST /orders/:orderId/pay` published den `BuyTicketEvent`. Daher gibt es hier
 * auch keinen Publish-Rollback-Pfad mehr; die Freigabe einer Reservierung
 * uebernimmt die Cancel-Route bzw. der Pay-Rollback.
 *
 * Der Reservierungs-Record enthaelt die Kaeuferdaten (`firstName`/`lastName`),
 * damit die Pay-Route den `BuyTicketEvent` daraus rekonstruieren kann.
 */
export async function queueBuyTicketPurchase({
  eventId,
  body,
  redis,
  pendingOrderTtlSeconds = env.REDIS_PENDING_ORDER_TTL_SECONDS,
  createOrderId = randomUUID,
  onReservationCreated,
}: QueueBuyTicketPurchaseInput): Promise<BuyTicketResponse> {
  const keys = ticketRedisKeys(eventId);
  const orderId = createOrderId();
  const orderCacheKey = orderRedisKeys.entry(orderId);
  const orderCacheValue = JSON.stringify({
    orderId,
    eventId,
    status: "pending",
    firstName: body.firstName,
    lastName: body.lastName,
  } satisfies PendingOrderReservation);
  // Zeitstempel wird zweifach genutzt: Ledger-Score (ZADD) und Sale-Unlock-
  // Check (opensAt). `queuedAt` fuer die E2E-Latenz setzt erst die Pay-Route
  // beim Publish — der Buy misst keine Queue-Latenz mehr (ADR-028).
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

  return {
    message: "Ticket reserved",
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
        // Ausverkauft (Lua-Reserve liefert < 0 → ConflictError).
        409: conflictErrorResponseSchema,
        // Verkauf noch nicht freigegeben (Sale-Unlock-Gate, Lua-Reserve liefert
        // -2 → TooEarlyError, RFC 8470; siehe ADR-024).
        425: tooEarlyErrorResponseSchema,
      },
    },
    handler: async (req, res) => {
      const { eventId } = req.params;
      const response = await queueBuyTicketPurchase({
        eventId,
        body: req.body,
        redis,
        onReservationCreated: () =>
          reservationsCreatedTotal.inc({ event_id: eventId }),
      });

      ordersAcceptedTotal.inc({ event_id: eventId });
      return res.status(202).send(response);
    },
  });
};

export default ticketBuyRoute;
