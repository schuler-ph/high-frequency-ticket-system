import {
  buyTicketEventSchema,
  conflictErrorResponseSchema,
  checkoutOrderReservationSchema,
  notFoundErrorResponseSchema,
  orderIdParamsSchema,
  paymentRequestSchema,
  paymentResponseSchema,
  type BuyTicketEvent,
  type PaymentResponse,
} from "@repo/types/tickets";
import { ConflictError, NotFoundError } from "@repo/types/errors";
import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
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

type PayReservationRedis = Pick<
  TicketRedisScripts,
  "claimPayment" | "markPaymentPublished" | "releaseTicketReservation"
>;

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
 * Vor dem Publish claimt ein Lua-Script den Checkout atomar von `pending` nach
 * `publishing`. Cancel und Reaper duerfen diesen Zustand nicht freigeben. Nach
 * bestaetigtem Publish wird er zu `paid`; der Worker ersetzt ihn spaeter durch
 * `completed|failed`. Fehlt der Record → `404`; ist er nicht mehr `pending`
 * → `409`.
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
  const queuedAt = createQueuedAt();
  const [claimResult, claimedRaw] = await redis.claimPayment(
    orderCacheKey,
    queuedAt,
  );

  if (claimResult === 0) {
    throw new NotFoundError(`Reservation ${orderId} not found`);
  }

  if (claimResult !== 1 || claimedRaw == null) {
    throw new ConflictError(`Order ${orderId} is not awaiting payment`);
  }

  const reservation = checkoutOrderReservationSchema.safeParse(
    JSON.parse(claimedRaw),
  );
  if (!reservation.success || reservation.data.status !== "publishing") {
    throw new ConflictError(`Order ${orderId} is not awaiting payment`);
  }

  const { eventId, firstName, lastName } = reservation.data;
  const payload = {
    orderId,
    eventId,
    firstName,
    lastName,
    queuedAt,
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
        "publishing",
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

  await redis.markPaymentPublished(orderCacheKey);
  onPaymentConfirmed?.(eventId);

  return {
    confirmed: true,
    orderId,
  };
}

const orderPayRoute: FastifyPluginAsyncZod = async (fastify, _opts) => {
  const scripts = registerTicketRedisScripts(fastify.redis);
  const redis: PayReservationRedis = {
    claimPayment: scripts.claimPayment.bind(scripts),
    markPaymentPublished: scripts.markPaymentPublished.bind(scripts),
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
