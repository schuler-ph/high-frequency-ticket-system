import {
  checkoutOrderReservationSchema,
  finalOrderCacheEntrySchema,
  orderIdParamsSchema,
  orderStatusNotFoundResponseSchema,
  orderStatusResponseSchema,
} from "@repo/types/tickets";
import { NotFoundError } from "@repo/types/errors";
import { orderRedisKeys } from "@repo/types/redis-keys";
import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import type {} from "@fastify/redis";

const parseOrderCacheEntry = (value: string, serverTime: number) => {
  const raw: unknown = JSON.parse(value);
  const checkout = checkoutOrderReservationSchema.safeParse(raw);

  // `publishing|paid` are internal safety states. Publicly the checkout stays
  // pending until the worker exposes a terminal `completed|failed` result, so
  // existing clients keep polling instead of treating `publishing` as final.
  //
  // `expiresAt` kommt aus dem Record und bleibt auch in `publishing|paid`
  // sichtbar: der Client soll den Countdown nicht verlieren, nur weil der
  // Publish gerade laeuft. `serverTime` verankert ihn gegen Client-Clock-Skew.
  if (checkout.success) {
    return {
      orderId: checkout.data.orderId,
      eventId: checkout.data.eventId,
      status: "pending" as const,
      expiresAt: checkout.data.expiresAt,
      serverTime,
    };
  }

  // Alles, was kein Checkout-Zustand ist, muss ein finaler Record des Workers
  // sein; ein `pending` ohne Kaeuferdaten kann in Redis nicht entstehen.
  return finalOrderCacheEntrySchema.parse(raw);
};

const orderStatusRoute: FastifyPluginAsyncZod = async (fastify, _opts) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/:orderId",
    schema: {
      params: orderIdParamsSchema,
      response: {
        200: orderStatusResponseSchema,
        404: orderStatusNotFoundResponseSchema,
      },
    },
    handler: async (req, res) => {
      const { redis } = fastify;
      const orderCacheKey = orderRedisKeys.entry(req.params.orderId);
      const cachedOrder = await redis.get(orderCacheKey);

      if (cachedOrder == null) {
        throw new NotFoundError(`Order ${req.params.orderId} not found`);
      }

      return res
        .status(200)
        .send(parseOrderCacheEntry(cachedOrder, Date.now()));
    },
  });
};

export default orderStatusRoute;
