import {
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

type OrderRedisClient = {
  get: (key: string) => Promise<string | null>;
};

const parseOrderCacheEntry = (value: string) =>
  orderStatusResponseSchema.parse(JSON.parse(value));

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
      const { redis } = fastify as typeof fastify & {
        redis: OrderRedisClient;
      };
      const orderCacheKey = orderRedisKeys.entry(req.params.orderId);
      const cachedOrder = await redis.get(orderCacheKey);

      if (cachedOrder == null) {
        throw new NotFoundError(`Order ${req.params.orderId} not found`);
      }

      return res.status(200).send(parseOrderCacheEntry(cachedOrder));
    },
  });
};

export default orderStatusRoute;
