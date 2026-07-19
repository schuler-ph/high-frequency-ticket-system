import {
  cancelOrderResponseSchema,
  conflictErrorResponseSchema,
  orderIdParamsSchema,
  pendingOrderReservationSchema,
  type CancelOrderResponse,
} from "@repo/types/tickets";
import { ConflictError } from "@repo/types/errors";
import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import { checkoutsCancelledTotal } from "../../../lib/metrics.ts";
import {
  registerTicketRedisScripts,
  type TicketRedisScripts,
} from "../../../lib/redis-scripts.ts";
import type {} from "@fastify/redis";

type CancelReservationRedis = Pick<RedisClient, "get"> &
  Pick<TicketRedisScripts, "releaseTicketReservation">;

type CancelReservationInput = {
  orderId: string;
  redis: CancelReservationRedis;
  onCheckoutCancelled?: (eventId: string) => void;
};

/**
 * Gibt eine noch nicht bezahlte Reservierung frei — der Gegenweg zu `POST /buy`
 * fuer Modal-Abbruch/Timeout im Checkout (ADR-028). Ohne diese Route bliebe die
 * Ledger-Reservierung als Phantom-Anspruch stehen (ZSet ohne TTL, ADR-027);
 * das Aufraeumen wirklich verwaister Reservierungen bleibt zusaetzlich beim
 * Reaper (Phase 6).
 *
 * Idempotent: existiert kein Reservierungs-Record (mehr), ist nichts zu tun
 * (`cancelled: false`). Ist die Order bereits finalisiert (bezahlt →
 * completed/failed), kann sie nicht mehr storniert werden → `409`.
 */
export async function cancelReservation({
  orderId,
  redis,
  onCheckoutCancelled,
}: CancelReservationInput): Promise<CancelOrderResponse> {
  const orderCacheKey = orderRedisKeys.entry(orderId);
  const cached = await redis.get(orderCacheKey);

  if (cached == null) {
    return { cancelled: false, orderId };
  }

  const reservation = pendingOrderReservationSchema.safeParse(
    JSON.parse(cached),
  );
  if (!reservation.success) {
    throw new ConflictError(`Order ${orderId} can no longer be cancelled`);
  }

  const { eventId } = reservation.data;
  const keys = ticketRedisKeys(eventId);
  const released = await redis.releaseTicketReservation(
    keys.reservations,
    keys.available,
    orderCacheKey,
    orderId,
  );

  if (released === 1) {
    onCheckoutCancelled?.(eventId);
  }

  return { cancelled: released === 1, orderId };
}

const orderCancelRoute: FastifyPluginAsyncZod = async (fastify, _opts) => {
  const scripts = registerTicketRedisScripts(fastify.redis);
  const redis: CancelReservationRedis = {
    get: (key) => fastify.redis.get(key),
    releaseTicketReservation: scripts.releaseTicketReservation.bind(scripts),
  };

  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:orderId/cancel",
    schema: {
      params: orderIdParamsSchema,
      response: {
        200: cancelOrderResponseSchema,
        // Order bereits finalisiert (bezahlt → completed/failed) → nicht mehr
        // stornierbar → ConflictError. Fehlende Reservierung ist idempotent
        // `200 { cancelled: false }`, kein Fehler.
        409: conflictErrorResponseSchema,
      },
    },
    handler: async (req, res) => {
      const { orderId } = req.params;
      const response = await cancelReservation({
        orderId,
        redis,
        onCheckoutCancelled: (eventId) =>
          checkoutsCancelledTotal.inc({ event_id: eventId }),
      });

      return res.status(200).send(response);
    },
  });
};

export default orderCancelRoute;
