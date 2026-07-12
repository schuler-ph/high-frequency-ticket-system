import type { FastifyPluginAsync } from "fastify";
import {
  executeBuyTicket,
  listEventInventorySnapshots,
  markOrderFailed,
} from "@repo/db";
import { env } from "@repo/env";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import {
  handleBuyTicketMessage,
  type BuyTicketMessageHandlerDeps,
} from "../lib/handle-buy-ticket-message.ts";
import { registerWorkerRedisScripts } from "../lib/redis-scripts.ts";
import { reconcileTicketAvailability } from "../lib/reconcile-ticket-availability.ts";
import {
  ordersCompletedTotal,
  ordersFailedTotal,
  orderE2eLatencySeconds,
  processingLockConflictsTotal,
  redisDbDriftTickets,
  workerCompensationsTotal,
  workerIdempotencyHitsTotal,
  workerRedeliveriesTotal,
} from "../lib/metrics.ts";
import type {} from "@fastify/redis";
import type {} from "../plugins/pubsub.ts";

type TicketRedisClient = Pick<
  RedisClient,
  "get" | "scan" | "mset" | "incrby" | "defineCommand"
>;

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

const runStartupReconcile = async (
  deps: Pick<
    PubSubListenerRouteDeps,
    "listEventInventorySnapshots" | "reconcileTicketAvailability"
  > & {
    redis: Pick<RedisClient, "get" | "scan" | "mset" | "incrby">;
  },
): Promise<void> => {
  await deps.reconcileTicketAvailability({
    getEventInventorySnapshots: deps.listEventInventorySnapshots,
    redis: deps.redis,
    onEventReconciled: (eventId, redisAvailable, computedAvailable) =>
      redisDbDriftTickets.set(
        { event_id: eventId },
        redisAvailable - computedAvailable,
      ),
  });
};

const createPubSubListenerRoutes = (
  routeDeps: PubSubListenerRouteDeps = defaultPubSubListenerRouteDeps,
): FastifyPluginAsync => {
  const pubSubListenerRoutes: FastifyPluginAsync = async (fastify) => {
    const redis: TicketRedisClient = fastify.redis;
    const scripts = registerWorkerRedisScripts(redis);

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
        beginOrderProcessing: async (payload) => {
          const keys = ticketRedisKeys(payload.eventId);
          return scripts.beginOrderProcessing(
            keys.processed(payload.orderId),
            keys.processing(payload.orderId),
            payload.orderId,
            env.REDIS_WORKER_PROCESSING_LOCK_TTL_SECONDS,
          );
        },
        finalizeOrder: async (payload, entry) => {
          const keys = ticketRedisKeys(payload.eventId);
          await scripts.finalizeOrderProcessing(
            orderRedisKeys.entry(payload.orderId),
            keys.processed(payload.orderId),
            keys.processing(payload.orderId),
            JSON.stringify(entry),
            env.REDIS_FINAL_ORDER_TTL_SECONDS,
            payload.orderId,
            env.REDIS_WORKER_PROCESSED_TTL_SECONDS,
          );
        },
        compensateReservation: async (payload) => {
          const keys = ticketRedisKeys(payload.eventId);
          const releaseResult = await scripts.compensateReservation(
            keys.reservation(payload.orderId),
            keys.available,
          );

          return releaseResult === 1 ? "released" : "already-released";
        },
        markOrderFailed: async (payload, failureReason) =>
          routeDeps.markOrderFailed(payload.orderId, failureReason),
        releaseProcessingLock: async (payload) => {
          const keys = ticketRedisKeys(payload.eventId);
          await fastify.redis.del(keys.processing(payload.orderId));
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
  handleBuyTicketMessage,
  runStartupReconcile,
};
