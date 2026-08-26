import type { FastifyPluginAsync } from "fastify";
import type { Message } from "@google-cloud/pubsub";
import {
  executeBuyTicket,
  listEventInventorySnapshots,
  markOrderFailed,
  persistEventSoldCounts,
} from "@repo/db";
import { env } from "@repo/env";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import {
  handleBuyTicketMessage,
  type BuyTicketMessageHandlerDeps,
  type BuyTicketOutcome,
} from "../lib/handle-buy-ticket-message.ts";
import { auditTicketInventory } from "../lib/inventory-auditor.ts";
import { reapPendingReservations } from "../lib/pending-reservation-reaper.ts";
import { registerWorkerRedisScripts } from "../lib/redis-scripts.ts";
import type { WorkerRedisScripts } from "../lib/redis-scripts.ts";
import { projectSoldCounts } from "../lib/sold-count-projector.ts";
import {
  inventoryAuditDurationSeconds,
  inventoryAuditLastSuccessTimestampSeconds,
  inventoryAuditRunsTotal,
  inventoryAvailableTickets,
  inventoryCapacityTickets,
  inventoryCapacityDeltaTickets,
  inventorySoldTickets,
  ordersCompletedTotal,
  ordersFailedTotal,
  orderE2eLatencySeconds,
  redisDbDriftTickets,
  reservationLedgerActive,
  reservationLedgerStale,
  reservationReaperCandidates,
  reservationReaperErrorsTotal,
  reservationReaperOldestAgeSeconds,
  reservationReaperReleasesTotal,
  reservationReaperRunDurationSeconds,
  reservationReaperSkipsTotal,
  soldCountProjectorDurationSeconds,
  soldCountProjectorLastSuccessTimestampSeconds,
  soldCountProjectorRunsTotal,
  timeDbQuery,
  workerCompensationsTotal,
  workerDuplicateDeliveriesTotal,
  workerIdempotencyHitsTotal,
  workerRedeliveriesTotal,
} from "../lib/metrics.ts";
import type {} from "@fastify/redis";
import type {} from "../plugins/pubsub.ts";

type TicketRedisClient = Pick<
  RedisClient,
  "get" | "zcard" | "zcount" | "zrangebyscore" | "defineCommand"
>;

type InventoryCycleRedis = Pick<
  RedisClient,
  "get" | "zcard" | "zcount" | "zrangebyscore"
>;

type ReaperCycleRedis = Pick<RedisClient, "zcount" | "zrangebyscore"> &
  Pick<WorkerRedisScripts, "reapPendingReservation">;

type PubSubListenerRouteDeps = {
  executeBuyTicket: typeof executeBuyTicket;
  listEventInventorySnapshots: typeof listEventInventorySnapshots;
  persistEventSoldCounts: typeof persistEventSoldCounts;
  markOrderFailed: typeof markOrderFailed;
  auditTicketInventory: typeof auditTicketInventory;
  projectSoldCounts: typeof projectSoldCounts;
  reapPendingReservations: typeof reapPendingReservations;
};

const defaultPubSubListenerRouteDeps: PubSubListenerRouteDeps = {
  executeBuyTicket: (payload) =>
    timeDbQuery("buy_ticket", () => executeBuyTicket(payload)),
  listEventInventorySnapshots: () =>
    timeDbQuery("project_sold_counts", () => listEventInventorySnapshots()),
  persistEventSoldCounts: (snapshots) =>
    timeDbQuery("persist_sold_counts", () => persistEventSoldCounts(snapshots)),
  markOrderFailed: (orderId, failureReason) =>
    timeDbQuery("mark_order_failed", () =>
      markOrderFailed(orderId, failureReason),
    ),
  auditTicketInventory,
  projectSoldCounts,
  reapPendingReservations,
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
  // Redelivery, die den `processed`-Marker passiert hat (echte Gleichzeitigkeit)
  // und deren DB-Insert per ON CONFLICT absorbiert wurde. ACK wie `duplicate` —
  // die Nachricht ist erledigt. Bewusst NICHT `ordersCompletedTotal` und
  // bewusst ohne `observeE2eLatency`: es entstand kein zusaetzliches Ticket, und
  // eine zweite Latenz-Beobachtung wuerde das Histogramm verzerren.
  "duplicate-absorbed": {
    ack: true,
    record: (o) => workerDuplicateDeliveriesTotal.inc({ event_id: o.eventId }),
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

type InventoryCycleResult =
  | { status: "fulfilled" }
  | { status: "rejected"; reason: unknown };

/**
 * Runs one inventory observation cycle from exactly one grouped ticket
 * snapshot. Projector and auditor are independent after that read: a failed
 * read-model write never prevents the read-only audit, and neither failure can
 * mutate or reconstruct Redis inventory (ADR-031). The event ids of the
 * snapshot are handed back so the reaper — which runs on its own cadence
 * (ADR-037) — knows which ledgers to inspect without a DB read of its own.
 */
const runInventoryCycle = async (
  deps: Pick<
    PubSubListenerRouteDeps,
    | "listEventInventorySnapshots"
    | "persistEventSoldCounts"
    | "auditTicketInventory"
    | "projectSoldCounts"
  > & {
    redis: InventoryCycleRedis;
    now?: () => number;
  },
): Promise<{
  projector: InventoryCycleResult;
  auditor: InventoryCycleResult;
  eventIds: string[];
}> => {
  const now = deps.now ?? Date.now;
  const cycleNow = now();
  let snapshots: Awaited<
    ReturnType<PubSubListenerRouteDeps["listEventInventorySnapshots"]>
  >;

  try {
    snapshots = await deps.listEventInventorySnapshots();
  } catch (error: unknown) {
    soldCountProjectorRunsTotal.inc({ result: "error" });
    inventoryAuditRunsTotal.inc({ result: "error" });
    throw error;
  }

  const projector = (async (): Promise<void> => {
    const end = soldCountProjectorDurationSeconds.startTimer();
    try {
      await deps.projectSoldCounts({
        snapshots,
        persistSoldCounts: deps.persistEventSoldCounts,
      });
      soldCountProjectorRunsTotal.inc({ result: "success" });
      soldCountProjectorLastSuccessTimestampSeconds.set(cycleNow / 1000);
    } catch (error: unknown) {
      soldCountProjectorRunsTotal.inc({ result: "error" });
      throw error;
    } finally {
      end();
    }
  })();

  const auditor = (async (): Promise<void> => {
    const end = inventoryAuditDurationSeconds.startTimer();
    try {
      await deps.auditTicketInventory({
        snapshots,
        redis: deps.redis,
        staleScoreCeiling: cycleNow,
        onEventAudited: (audit) => {
          inventoryCapacityTickets.set(
            { event_id: audit.eventId },
            audit.totalCapacity,
          );
          inventoryAvailableTickets.set(
            { event_id: audit.eventId },
            audit.available,
          );
          inventorySoldTickets.set(
            { event_id: audit.eventId },
            audit.soldCount,
          );
          inventoryCapacityDeltaTickets.set(
            { event_id: audit.eventId },
            audit.capacityDelta,
          );
          // Transitional alias for existing reports/dashboards (ADR-031).
          redisDbDriftTickets.set(
            { event_id: audit.eventId },
            audit.capacityDelta,
          );
          reservationLedgerActive.set(
            { event_id: audit.eventId },
            audit.activeReservations,
          );
          reservationLedgerStale.set(
            { event_id: audit.eventId },
            audit.staleReservations,
          );
        },
      });
      inventoryAuditRunsTotal.inc({ result: "success" });
      inventoryAuditLastSuccessTimestampSeconds.set(cycleNow / 1000);
    } catch (error: unknown) {
      inventoryAuditRunsTotal.inc({ result: "error" });
      throw error;
    } finally {
      end();
    }
  })();

  const [projectorResult, auditorResult] = await Promise.allSettled([
    projector,
    auditor,
  ]);

  return {
    projector:
      projectorResult.status === "fulfilled"
        ? { status: "fulfilled" }
        : { status: "rejected", reason: projectorResult.reason },
    auditor:
      auditorResult.status === "fulfilled"
        ? { status: "fulfilled" }
        : { status: "rejected", reason: auditorResult.reason },
    eventIds: snapshots.map((snapshot) => snapshot.eventId),
  };
};

/**
 * Runs one reaper pass over the given events. Redis-only: candidates come from
 * the ZSet score, the release is the identity-based Lua script, and the event
 * list is whatever the last inventory cycle saw. Own cadence (ADR-037): an
 * expired claim must not wait for the next `COUNT(tickets)` snapshot to be
 * released — with a 12-s checkout deadline a 60-s cycle would hold it for five
 * deadlines. Never throws; a failure is reported as `rejected` so the scheduler
 * can log it and carry on.
 */
const runReaperCycle = async (
  deps: Pick<PubSubListenerRouteDeps, "reapPendingReservations"> & {
    redis: ReaperCycleRedis;
    eventIds: readonly string[];
    now?: () => number;
    onReaperError?: (
      eventId: string,
      orderId: string | null,
      error: unknown,
    ) => void;
  },
): Promise<InventoryCycleResult> => {
  const now = deps.now ?? Date.now;
  const end = reservationReaperRunDurationSeconds.startTimer();
  try {
    await deps.reapPendingReservations({
      eventIds: deps.eventIds,
      redis: deps.redis,
      nowMs: now(),
      batchSize: env.WORKER_RESERVATION_REAPER_BATCH_SIZE,
      // Der Grabstein ist ein finales Read-Model und bekommt dieselbe
      // Cleanup-TTL wie `completed|failed`.
      expiredTtlSeconds: env.REDIS_FINAL_ORDER_TTL_SECONDS,
      onEventReaped: (result) => {
        reservationReaperCandidates.set(
          { event_id: result.eventId },
          result.candidates,
        );
        reservationReaperOldestAgeSeconds.set(
          { event_id: result.eventId },
          result.oldestReleasedAgeSeconds,
        );
        if (result.released > 0) {
          reservationReaperReleasesTotal.inc(
            { event_id: result.eventId },
            result.released,
          );
        }
        for (const [reason, count] of Object.entries(result.skipped)) {
          if (count > 0) {
            reservationReaperSkipsTotal.inc(
              { event_id: result.eventId, reason },
              count,
            );
          }
        }
      },
      onError: (eventId, orderId, error) => {
        reservationReaperErrorsTotal.inc({ event_id: eventId });
        deps.onReaperError?.(eventId, orderId, error);
      },
    });
    return { status: "fulfilled" };
  } catch (error: unknown) {
    return { status: "rejected", reason: error };
  } finally {
    end();
  }
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
          // 1 = Ledger-Anspruch war noch da -> Erst-Finalisierung.
          // 0 = schon entfernt -> absorbierte Duplikat-Auslieferung.
          const removedFromLedger = await scripts.finalizeOrderProcessing(
            orderRedisKeys.entry(payload.orderId),
            keys.processed(payload.orderId),
            keys.reservations,
            JSON.stringify(entry),
            env.REDIS_FINAL_ORDER_TTL_SECONDS,
            payload.orderId,
            env.REDIS_WORKER_PROCESSED_TTL_SECONDS,
          );

          return removedFromLedger === 1;
        },
        compensateReservation: async (payload) => {
          const keys = ticketRedisKeys(payload.eventId);
          const releaseResult = await scripts.compensateReservation(
            keys.reservations,
            keys.available,
            payload.orderId,
          );

          return releaseResult === 1 ? "released" : "already-released";
        },
        markOrderFailed: async (payload, failureReason) =>
          routeDeps.markOrderFailed(payload.orderId, failureReason),
      });

      applyBuyTicketOutcome(message, outcome);
    });

    let inventoryCycleTimeout: ReturnType<typeof setTimeout> | undefined;
    let reaperTimeout: ReturnType<typeof setTimeout> | undefined;
    let closing = false;
    // Event-Ids des letzten erfolgreichen Snapshots — die einzige Zutat, die
    // der Reaper aus der DB braucht (ADR-037). Vor dem ersten Snapshot gibt es
    // nichts zu reapen; der Reaper startet deshalb aus dem ersten Cycle heraus
    // und plant sich danach in seinem eigenen, dichteren Takt selbst neu.
    let reaperEventIds: readonly string[] = [];
    let reaperStarted = false;

    const runAndScheduleReaper = (): void => {
      void runReaperCycle({
        reapPendingReservations: routeDeps.reapPendingReservations,
        eventIds: reaperEventIds,
        redis: {
          zcount: redis.zcount.bind(redis),
          zrangebyscore: redis.zrangebyscore.bind(redis),
          reapPendingReservation: scripts.reapPendingReservation.bind(scripts),
        },
        onReaperError: (eventId, orderId, error) => {
          fastify.log.error(
            { err: error, eventId, orderId },
            "Pending reservation reaper candidate failed",
          );
        },
      })
        .then((result) => {
          if (result.status === "rejected") {
            fastify.log.error(
              { err: result.reason },
              "Pending reservation reaper failed",
            );
          }
        })
        .finally(() => {
          if (!closing) {
            reaperTimeout = setTimeout(
              runAndScheduleReaper,
              env.WORKER_RESERVATION_REAPER_INTERVAL_SECONDS * 1000,
            );
            reaperTimeout.unref();
          }
        });
    };

    const runAndScheduleInventoryCycle = (): void => {
      void runInventoryCycle({
        listEventInventorySnapshots: routeDeps.listEventInventorySnapshots,
        persistEventSoldCounts: routeDeps.persistEventSoldCounts,
        auditTicketInventory: routeDeps.auditTicketInventory,
        projectSoldCounts: routeDeps.projectSoldCounts,
        redis: {
          get: redis.get.bind(redis),
          zcard: redis.zcard.bind(redis),
          zcount: redis.zcount.bind(redis),
          zrangebyscore: redis.zrangebyscore.bind(redis),
        },
      })
        .then((result) => {
          reaperEventIds = result.eventIds;
          if (!reaperStarted && !closing) {
            reaperStarted = true;
            runAndScheduleReaper();
          }
          if (result.projector.status === "rejected") {
            fastify.log.error(
              { err: result.projector.reason },
              "Sold-count projection failed",
            );
          }
          if (result.auditor.status === "rejected") {
            fastify.log.error(
              { err: result.auditor.reason },
              "Inventory audit failed",
            );
          }
        })
        .catch((err: unknown) => {
          fastify.log.error({ err }, "Inventory snapshot aggregation failed");
        })
        .finally(() => {
          if (!closing) {
            inventoryCycleTimeout = setTimeout(
              runAndScheduleInventoryCycle,
              env.WORKER_INVENTORY_CYCLE_INTERVAL_SECONDS * 1000,
            );
            inventoryCycleTimeout.unref();
          }
        });
    };

    fastify.addHook("onReady", () => {
      // Auditor/projector are observability/read-model concerns. Their startup
      // failure must never stop the message consumer.
      fastify.pubsubSubscriber.start();
      runAndScheduleInventoryCycle();
    });

    fastify.addHook("onClose", () => {
      closing = true;
      if (inventoryCycleTimeout !== undefined) {
        clearTimeout(inventoryCycleTimeout);
      }
      if (reaperTimeout !== undefined) {
        clearTimeout(reaperTimeout);
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
  runInventoryCycle,
  runReaperCycle,
};
