import type { FastifyPluginAsync } from "fastify";
import type { Message } from "@google-cloud/pubsub";
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
  type BuyTicketOutcome,
} from "../lib/handle-buy-ticket-message.ts";
import { registerWorkerRedisScripts } from "../lib/redis-scripts.ts";
import { reconcileTicketAvailability } from "../lib/reconcile-ticket-availability.ts";
import {
  ordersCompletedTotal,
  ordersFailedTotal,
  orderE2eLatencySeconds,
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

const observeE2eLatency = (
  eventId: string,
  queuedAt: number,
  status: "completed" | "failed",
): void => {
  orderE2eLatencySeconds.observe(
    { event_id: eventId, status },
    (Date.now() - queuedAt) / 1000,
  );
};

/**
 * Die ACK/NACK-Tabelle aus `docs/ARCHITECTURE.md` als Code: pro Outcome-Kind
 * genau eine Zeile mit ACK-Entscheidung und Metriken. Neue Faelle sind eine
 * neue Zeile, kein neuer try/catch-Ast im Handler.
 */
export const buyTicketOutcomePolicy: {
  [K in BuyTicketOutcome["kind"]]: {
    ack: boolean;
    record?: (outcome: Extract<BuyTicketOutcome, { kind: K }>) => void;
  };
} = {
  completed: {
    ack: true,
    record: (o) => {
      ordersCompletedTotal.inc({ event_id: o.eventId });
      observeE2eLatency(o.eventId, o.queuedAt, "completed");
    },
  },
  duplicate: {
    ack: true,
    record: (o) => workerIdempotencyHitsTotal.inc({ event_id: o.eventId }),
  },
  "invalid-payload": { ack: false },
  "terminal-failed": {
    ack: true,
    record: (o) => {
      workerCompensationsTotal.inc({ event_id: o.eventId });
      ordersFailedTotal.inc({ event_id: o.eventId });
      observeE2eLatency(o.eventId, o.queuedAt, "failed");
    },
  },
  "compensation-failed": { ack: false },
  "transient-error": {
    ack: false,
    record: (o) => workerRedeliveriesTotal.inc({ event_id: o.eventId }),
  },
};

export const applyBuyTicketOutcome = (
  message: Pick<Message, "ack" | "nack">,
  outcome: BuyTicketOutcome,
): void => {
  const policy = buyTicketOutcomePolicy[outcome.kind] as {
    ack: boolean;
    record?: (outcome: BuyTicketOutcome) => void;
  };

  policy.record?.(outcome);

  if (policy.ack) {
    message.ack();
  } else {
    message.nack();
  }
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
      const outcome = await handleBuyTicketMessage(message, {
        logger: fastify.log,
        executeBuyTicket: routeDeps.executeBuyTicket,
        isOrderProcessed: async (payload) => {
          const keys = ticketRedisKeys(payload.eventId);
          return (await redis.get(keys.processed(payload.orderId))) !== null;
        },
        finalizeOrder: async (payload, entry) => {
          const keys = ticketRedisKeys(payload.eventId);
          await scripts.finalizeOrderProcessing(
            orderRedisKeys.entry(payload.orderId),
            keys.processed(payload.orderId),
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
      });

      applyBuyTicketOutcome(message, outcome);
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
