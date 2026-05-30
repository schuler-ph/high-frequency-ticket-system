import type { FastifyPluginAsync } from "fastify";
import {
  executeBuyTicket,
  listEventInventorySnapshots,
  markOrderFailed,
} from "@repo/db";
import { env } from "@repo/env";
import {
  orderCacheEntrySchema,
  type OrderCacheEntry,
} from "@repo/types/tickets";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import {
  handleBuyTicketMessage,
  type BuyTicketMessageHandlerDeps,
} from "../lib/handle-buy-ticket-message.ts";
import { reconcileTicketAvailability } from "../lib/reconcile-ticket-availability.ts";
import {
  ordersCompletedTotal,
  ordersFailedTotal,
  orderE2eLatencySeconds,
  processingLockConflictsTotal,
  workerCompensationsTotal,
  workerIdempotencyHitsTotal,
  workerRedeliveriesTotal,
} from "../lib/metrics.ts";
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
  scan: (
    cursor: string,
    matchToken: "MATCH",
    pattern: string,
    countToken: "COUNT",
    count: number,
  ) => Promise<[string, string[]]>;
  mset: (values: Record<string, string>) => Promise<unknown>;
};

type PubSubListenerRouteDeps = {
  executeBuyTicket: typeof executeBuyTicket;
  listEventInventorySnapshots: typeof listEventInventorySnapshots;
  markOrderFailed: typeof markOrderFailed;
  reconcileTicketAvailability: typeof reconcileTicketAvailability;
};

const defaultPubSubListenerRouteDeps: PubSubListenerRouteDeps = {
  executeBuyTicket,
  listEventInventorySnapshots,
  markOrderFailed,
  reconcileTicketAvailability,
};

const getReconcileIntervalMs = (): number => {
  const seconds =
    env.WORKER_RECONCILE_MODE === "peak"
      ? env.WORKER_RECONCILE_INTERVAL_PEAK_SECONDS
      : env.WORKER_RECONCILE_INTERVAL_NORMAL_SECONDS;
  return seconds * 1000;
};

const getOrderCacheEntryTtlSeconds = (entry: OrderCacheEntry): number =>
  entry.status === "pending"
    ? env.REDIS_PENDING_ORDER_TTL_SECONDS
    : env.REDIS_FINAL_ORDER_TTL_SECONDS;

const writeOrderCacheEntry = async (
  redis: TicketRedisClient,
  entry: OrderCacheEntry,
): Promise<void> => {
  const key = orderRedisKeys.entry(entry.orderId);
  const value = JSON.stringify(orderCacheEntrySchema.parse(entry));
  const result = await redis.set(
    key,
    value,
    "EX",
    getOrderCacheEntryTtlSeconds(entry),
  );

  if (result !== "OK") {
    throw new Error("Failed to write order cache entry");
  }
};

const runStartupReconcile = async (
  deps: Pick<
    PubSubListenerRouteDeps,
    "listEventInventorySnapshots" | "reconcileTicketAvailability"
  > & {
    redis: TicketRedisClient;
  },
): Promise<void> => {
  await deps.reconcileTicketAvailability({
    getEventInventorySnapshots: deps.listEventInventorySnapshots,
    redis: deps.redis,
  });
};

const createPubSubListenerRoutes = (
  routeDeps: PubSubListenerRouteDeps = defaultPubSubListenerRouteDeps,
): FastifyPluginAsync => {
  const pubSubListenerRoutes: FastifyPluginAsync = async (fastify) => {
    const redis = (fastify as typeof fastify & { redis: TicketRedisClient })
      .redis;

    fastify.pubsubSubscriber.onMessage(async (message) => {
      await handleBuyTicketMessage(message, {
        logger: fastify.log,
        executeBuyTicket: routeDeps.executeBuyTicket,
        metrics: {
          onOrderCompleted: (eventId) =>
            ordersCompletedTotal.inc({ event_id: eventId }),
          onOrderFailed: (eventId) =>
            ordersFailedTotal.inc({ event_id: eventId }),
          onCompensation: (eventId) =>
            workerCompensationsTotal.inc({ event_id: eventId }),
          onRedelivery: (eventId) =>
            workerRedeliveriesTotal.inc({ event_id: eventId }),
          onIdempotencyHit: (eventId) =>
            workerIdempotencyHitsTotal.inc({ event_id: eventId }),
          onLockConflict: (eventId) =>
            processingLockConflictsTotal.inc({ event_id: eventId }),
          onE2eLatency: (eventId, durationSeconds, status) =>
            orderE2eLatencySeconds.observe(
              { event_id: eventId, status },
              durationSeconds,
            ),
        },
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
          routeDeps.markOrderFailed(payload.orderId, failureReason),
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
        writeOrderCacheEntry: async (entry) =>
          writeOrderCacheEntry(redis, entry),
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

    let reconcileTimeout: ReturnType<typeof setTimeout> | undefined;

    const scheduleNextReconcile = (): void => {
      reconcileTimeout = setTimeout(() => {
        runStartupReconcile({
          listEventInventorySnapshots: routeDeps.listEventInventorySnapshots,
          reconcileTicketAvailability: routeDeps.reconcileTicketAvailability,
          redis,
        })
          .catch((err: unknown) => {
            fastify.log.error({ err }, "Periodic reconcile failed");
          })
          .finally(() => {
            scheduleNextReconcile();
          });
      }, getReconcileIntervalMs());
      reconcileTimeout.unref();
    };

    fastify.addHook("onReady", async () => {
      await runStartupReconcile({
        listEventInventorySnapshots: routeDeps.listEventInventorySnapshots,
        reconcileTicketAvailability: routeDeps.reconcileTicketAvailability,
        redis,
      });

      scheduleNextReconcile();
      fastify.pubsubSubscriber.start();
    });

    fastify.addHook("onClose", async () => {
      if (reconcileTimeout !== undefined) {
        clearTimeout(reconcileTimeout);
      }
    });
  };

  return pubSubListenerRoutes;
};

const pubSubListenerRoutes = createPubSubListenerRoutes();

export default pubSubListenerRoutes;
export type { BuyTicketMessageHandlerDeps };
export {
  createPubSubListenerRoutes,
  getOrderCacheEntryTtlSeconds,
  handleBuyTicketMessage,
  runStartupReconcile,
  writeOrderCacheEntry,
};
