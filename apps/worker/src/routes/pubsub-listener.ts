import type { FastifyPluginAsync } from "fastify";
import { executeBuyTicket, markOrderFailed } from "@repo/db";
import { env } from "@repo/env";
import { ticketRedisKeys } from "@repo/types/redis-keys";
import {
  handleBuyTicketMessage,
  type BuyTicketMessageHandlerDeps,
} from "../lib/handle-buy-ticket-message.ts";
import type {} from "../plugins/pubsub.ts";

const RELEASE_RESERVATION_SCRIPT = `
local deleted = redis.call("DEL", KEYS[1])
if deleted == 1 then
  redis.call("INCR", KEYS[2])
  return 1
end

return 0
`;

type TicketRedisClient = {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
    condition?: "NX",
  ) => Promise<"OK" | null>;
  del: (key: string) => Promise<number>;
  eval: (
    script: string,
    numKeys: number,
    ...args: string[]
  ) => Promise<number | string>;
};

const pubSubListenerRoutes: FastifyPluginAsync = async (fastify) => {
  const redis = (fastify as typeof fastify & { redis: TicketRedisClient })
    .redis;

  fastify.pubsubSubscriber.onMessage(async (message) => {
    await handleBuyTicketMessage(message, {
      logger: fastify.log,
      executeBuyTicket,
      compensateReservation: async (payload) => {
        const keys = ticketRedisKeys(payload.eventId);
        const releaseResult = await redis.eval(
          RELEASE_RESERVATION_SCRIPT,
          2,
          keys.reservation(payload.orderId),
          keys.available,
        );

        return Number(releaseResult) === 1 ? "released" : "already-released";
      },
      markOrderFailed: async (payload, failureReason) =>
        markOrderFailed(payload.orderId, failureReason),
      isOrderProcessed: async (payload) => {
        const keys = ticketRedisKeys(payload.eventId);
        return (await redis.get(keys.processed(payload.orderId))) !== null;
      },
      tryAcquireProcessingLock: async (payload) => {
        const keys = ticketRedisKeys(payload.eventId);
        const lockResult = await redis.set(
          keys.processing(payload.orderId),
          payload.orderId,
          "EX",
          env.REDIS_WORKER_PROCESSING_LOCK_TTL_SECONDS,
          "NX",
        );

        return lockResult === "OK";
      },
      markOrderProcessed: async (payload) => {
        const keys = ticketRedisKeys(payload.eventId);
        const setResult = await redis.set(
          keys.processed(payload.orderId),
          payload.orderId,
          "EX",
          env.REDIS_WORKER_PROCESSED_TTL_SECONDS,
        );

        if (setResult !== "OK") {
          throw new Error("Failed to write processed marker");
        }
      },
      releaseProcessingLock: async (payload) => {
        const keys = ticketRedisKeys(payload.eventId);
        await redis.del(keys.processing(payload.orderId));
      },
    });
  });

  fastify.addHook("onReady", async () => {
    fastify.pubsubSubscriber.start();
  });
};

export default pubSubListenerRoutes;
export type { BuyTicketMessageHandlerDeps };
export { handleBuyTicketMessage };
