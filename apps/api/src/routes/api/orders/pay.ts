import {
  buyTicketEventSchema,
  conflictErrorResponseSchema,
  notFoundErrorResponseSchema,
  orderIdParamsSchema,
  paymentRequestSchema,
  paymentResponseSchema,
  pendingOrderReservationSchema,
  type BuyTicketEvent,
  type PaymentResponse,
} from "@repo/types/tickets";
import { ConflictError, NotFoundError } from "@repo/types/errors";
import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import {
  paymentsConfirmedTotal,
  publishRollbacksTotal,
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

type PayReservationRedis = Pick<RedisClient, "get"> &
  Pick<TicketRedisScripts, "releaseTicketReservation">;

type ConfirmPaymentInput = {
  orderId: string;
  redis: PayReservationRedis;
  pubsubPublisher: TicketPublisher;
  createQueuedAt?: () => number;
  onPaymentConfirmed?: (eventId: string) => void;
  onPublishRollback?: (eventId: string) => void;
};

/**
 * Bestaetigt die (simulierte) Zahlung und published den `BuyTicketEvent`
 * synchron an Pub/Sub. Nach dem Reserve/Pay-Split (ADR-028) ist das die
 * einzige Stelle, die published — der Worker sieht die Order also erst nach
 * bestaetigter Zahlung, waehrend das Ticket ueber die Buy-Reservierung bereits
 * gehalten wird.
 *
 * **Kein Server-Sleep:** die 3DS-Verzoegerung ist reine Frontend-UX. Die
 * Async-Writes-Regel bleibt gewahrt — die Route schreibt niemals in
 * PostgreSQL, sie published nur; die Persistenz traegt weiterhin der Worker.
 *
 * `queuedAt` wird hier (zum Pay-Zeitpunkt) gesetzt, damit die E2E-Latenz nur
 * noch Publish→Persist misst und nicht die Checkout-Denkzeit des Nutzers.
 *
 * Die Kaeuferdaten (`eventId`, `firstName`, `lastName`) stammen aus dem
 * Reservierungs-Record, den `POST /buy` unter `orders:{orderId}` hinterlegt
 * hat. Fehlt der Record → `404`; ist die Order nicht (mehr) `pending` (bereits
 * finalisiert) → `409`.
 */
export async function confirmPayment({
  orderId,
  redis,
  pubsubPublisher,
  createQueuedAt = Date.now,
  onPaymentConfirmed,
  onPublishRollback,
}: ConfirmPaymentInput): Promise<PaymentResponse> {
  const orderCacheKey = orderRedisKeys.entry(orderId);
  const cached = await redis.get(orderCacheKey);

  if (cached == null) {
    throw new NotFoundError(`Reservation ${orderId} not found`);
  }

  const reservation = pendingOrderReservationSchema.safeParse(
    JSON.parse(cached),
  );
  if (!reservation.success) {
    throw new ConflictError(`Order ${orderId} is not awaiting payment`);
  }

  const { eventId, firstName, lastName } = reservation.data;
  const payload = {
    orderId,
    eventId,
    firstName,
    lastName,
    queuedAt: createQueuedAt(),
  } satisfies BuyTicketEvent;

  try {
    await pubsubPublisher.publishBuyTicket(buyTicketEventSchema.parse(payload));
  } catch (error) {
    const keys = ticketRedisKeys(eventId);
    try {
      await redis.releaseTicketReservation(
        keys.reservations,
        keys.available,
        orderCacheKey,
        orderId,
      );
    } catch (releaseError) {
      onPublishRollback?.(eventId);
      throw new AggregateError(
        [error, releaseError],
        "Failed to confirm payment and fully roll back reservation",
      );
    }

    onPublishRollback?.(eventId);
    throw error;
  }

  onPaymentConfirmed?.(eventId);

  return {
    confirmed: true,
    orderId,
  };
}

const orderPayRoute: FastifyPluginAsyncZod = async (fastify, _opts) => {
  const scripts = registerTicketRedisScripts(fastify.redis);
  const redis: PayReservationRedis = {
    get: (key) => fastify.redis.get(key),
    releaseTicketReservation: scripts.releaseTicketReservation.bind(scripts),
  };

  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:orderId/pay",
    schema: {
      params: orderIdParamsSchema,
      // SIMULATION: Fake-Zahlungsdaten, werden validiert und dann verworfen —
      // keine Persistenz, kein echter Payment-Provider (ADR-013/ADR-028).
      body: paymentRequestSchema,
      response: {
        200: paymentResponseSchema,
        // Keine (aktive) Reservierung unter dieser orderId → NotFoundError.
        404: notFoundErrorResponseSchema,
        // Order ist nicht mehr `pending` (bereits finalisiert) → ConflictError.
        409: conflictErrorResponseSchema,
      },
    },
    handler: async (req, res) => {
      const { orderId } = req.params;
      const response = await confirmPayment({
        orderId,
        redis,
        pubsubPublisher: fastify.pubsubPublisher,
        onPaymentConfirmed: (eventId) =>
          paymentsConfirmedTotal.inc({ event_id: eventId }),
        onPublishRollback: (eventId) =>
          publishRollbacksTotal.inc({ event_id: eventId }),
      });

      return res.status(200).send(response);
    },
  });
};

export default orderPayRoute;
