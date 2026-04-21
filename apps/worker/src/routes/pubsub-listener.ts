import { setTimeout } from "node:timers/promises";
import type { Message } from "@google-cloud/pubsub";
import type { FastifyPluginAsync } from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "@repo/db";
import { env } from "@repo/env";
import { buyTicketEventSchema, type BuyTicketEvent } from "@repo/types/tickets";
import { ticketRedisKeys } from "@repo/types/redis-keys";
import {
  markOrderFailed,
  type FailedOrderUpdateResult,
} from "../lib/order-failures.js";
import type {} from "../plugins/pubsub.js";

type BuyTicketMessage = Pick<Message, "id" | "data" | "ack" | "nack">;

const RELEASE_RESERVATION_SCRIPT = `
local deleted = redis.call("DEL", KEYS[1])
if deleted == 1 then
  redis.call("INCR", KEYS[2])
  return 1
end

return 0
`;

type BuyTicketPayload = BuyTicketEvent;

type CompensationResult = "released" | "already-released";

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

export type BuyTicketMessageHandlerDeps = {
  logger: FastifyBaseLogger;
  executeBuyTicket: (payload: BuyTicketPayload) => Promise<string | null>;
  compensateReservation: (
    payload: BuyTicketPayload,
  ) => Promise<CompensationResult>;
  markOrderFailed: (
    payload: BuyTicketPayload,
    failureReason: string,
  ) => Promise<FailedOrderUpdateResult>;
  isOrderProcessed: (payload: BuyTicketPayload) => Promise<boolean>;
  tryAcquireProcessingLock: (payload: BuyTicketPayload) => Promise<boolean>;
  markOrderProcessed: (payload: BuyTicketPayload) => Promise<void>;
  releaseProcessingLock: (payload: BuyTicketPayload) => Promise<void>;
  sleep?: (ms: number) => Promise<unknown>;
};

const getCauseCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) return undefined;

  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("code" in cause)) {
    return undefined;
  }

  const code = cause.code;
  return typeof code === "string" ? code : undefined;
};

const getFailureReason = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Terminal BuyTicketEvent processing error";
};

export async function handleBuyTicketMessage(
  message: BuyTicketMessage,
  deps: BuyTicketMessageHandlerDeps,
): Promise<void> {
  const rawPayload = message.data?.toString("utf8") ?? "";

  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch (error) {
    deps.logger.warn(
      { messageId: message.id, error },
      "Invalid BuyTicketEvent payload JSON",
    );
    message.nack();
    return;
  }

  const parsed = buyTicketEventSchema.safeParse(payload);
  if (!parsed.success) {
    deps.logger.warn(
      { messageId: message.id, issues: parsed.error.issues },
      "BuyTicketEvent payload failed validation",
    );
    message.nack();
    return;
  }

  deps.logger.info(
    { messageId: message.id, eventId: parsed.data.eventId },
    "Received BuyTicketEvent",
  );

  if (await deps.isOrderProcessed(parsed.data)) {
    deps.logger.info(
      {
        messageId: message.id,
        eventId: parsed.data.eventId,
        orderId: parsed.data.orderId,
      },
      "Skipping already processed BuyTicketEvent",
    );
    message.ack();
    return;
  }

  const processingLockAcquired = await deps.tryAcquireProcessingLock(
    parsed.data,
  );

  if (!processingLockAcquired) {
    deps.logger.warn(
      {
        messageId: message.id,
        eventId: parsed.data.eventId,
        orderId: parsed.data.orderId,
      },
      "BuyTicketEvent is already being processed, nacking for redelivery",
    );
    message.nack();
    return;
  }

  try {
    await (deps.sleep ?? setTimeout)(1000);

    const ticketId = await deps.executeBuyTicket(parsed.data);
    await deps.markOrderProcessed(parsed.data);

    deps.logger.info(
      {
        messageId: message.id,
        eventId: parsed.data.eventId,
        orderId: parsed.data.orderId,
        ticketId,
      },
      "Successfully processed BuyTicketEvent",
    );

    message.ack();
    return;
  } catch (error) {
    if (getCauseCode(error) === "P0001") {
      const failureReason = getFailureReason(error);
      let failedOrderUpdate: FailedOrderUpdateResult;

      try {
        const compensationResult = await deps.compensateReservation(
          parsed.data,
        );

        failedOrderUpdate = await deps.markOrderFailed(
          parsed.data,
          failureReason,
        );

        deps.logger.warn(
          {
            messageId: message.id,
            eventId: parsed.data.eventId,
            orderId: parsed.data.orderId,
            compensation: compensationResult,
            failedOrderUpdate,
            failureReason,
          },
          "Compensated reservation after terminal BuyTicketEvent error",
        );
      } catch (compensationError) {
        deps.logger.error(
          {
            messageId: message.id,
            eventId: parsed.data.eventId,
            orderId: parsed.data.orderId,
            error,
            compensationError,
          },
          "Failed to compensate reservation or persist failed order after terminal BuyTicketEvent error",
        );
        message.nack();
        return;
      }

      try {
        await deps.markOrderProcessed(parsed.data);
      } catch (markProcessedError) {
        deps.logger.error(
          {
            messageId: message.id,
            eventId: parsed.data.eventId,
            orderId: parsed.data.orderId,
            error,
            markProcessedError,
          },
          "Failed to mark terminal BuyTicketEvent as processed",
        );
        message.nack();
        return;
      }

      deps.logger.warn(
        {
          messageId: message.id,
          eventId: parsed.data.eventId,
          orderId: parsed.data.orderId,
          failureReason,
          error,
        },
        "Event not found while processing BuyTicketEvent",
      );
      message.ack();
      return;
    }

    deps.logger.error(
      { messageId: message.id, eventId: parsed.data.eventId, error },
      "Error processing BuyTicketEvent",
    );
    message.nack();
    return;
  } finally {
    try {
      await deps.releaseProcessingLock(parsed.data);
    } catch (lockReleaseError) {
      deps.logger.error(
        {
          messageId: message.id,
          eventId: parsed.data.eventId,
          orderId: parsed.data.orderId,
          lockReleaseError,
        },
        "Failed to release BuyTicketEvent processing lock",
      );
    }
  }
}

const pubSubListenerRoutes: FastifyPluginAsync = async (fastify) => {
  const redis = (fastify as typeof fastify & { redis: TicketRedisClient })
    .redis;

  fastify.pubsubSubscriber.onMessage(async (message) => {
    await handleBuyTicketMessage(message, {
      logger: fastify.log,
      executeBuyTicket: async (payload) => {
        const result = await db.execute<{ ticket_id: string | null }>(
          sql`SELECT buy_ticket(${payload.eventId}, ${payload.orderId}, ${payload.firstName}, ${payload.lastName}) AS ticket_id`,
        );

        return result.rows[0]?.ticket_id ?? null;
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
