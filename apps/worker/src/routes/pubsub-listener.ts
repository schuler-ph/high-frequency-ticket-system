import { setTimeout } from "node:timers/promises";
import type { Message } from "@google-cloud/pubsub";
import type { FastifyPluginAsync } from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "@repo/db";
import { buyTicketEventSchema, type BuyTicketEvent } from "@repo/types/tickets";
import { ticketRedisKeys } from "@repo/types/redis-keys";
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
  eval: (
    script: string,
    numKeys: number,
    ...args: string[]
  ) => Promise<number | string>;
};

export type BuyTicketMessageHandlerDeps = {
  logger: FastifyBaseLogger;
  executeBuyTicket: (payload: BuyTicketPayload) => Promise<void>;
  compensateReservation: (
    payload: BuyTicketPayload,
  ) => Promise<CompensationResult>;
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

  await (deps.sleep ?? setTimeout)(1000);

  try {
    await deps.executeBuyTicket(parsed.data);
  } catch (error) {
    if (getCauseCode(error) === "P0001") {
      try {
        const compensationResult = await deps.compensateReservation(
          parsed.data,
        );

        deps.logger.warn(
          {
            messageId: message.id,
            eventId: parsed.data.eventId,
            orderId: parsed.data.orderId,
            compensation: compensationResult,
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
          "Failed to compensate reservation after terminal BuyTicketEvent error",
        );
        message.nack();
        return;
      }

      deps.logger.warn(
        {
          messageId: message.id,
          eventId: parsed.data.eventId,
          orderId: parsed.data.orderId,
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
  }

  deps.logger.info(
    { messageId: message.id, eventId: parsed.data.eventId },
    "Successfully processed BuyTicketEvent",
  );

  message.ack();
}

const pubSubListenerRoutes: FastifyPluginAsync = async (fastify) => {
  const redis = (fastify as typeof fastify & { redis: TicketRedisClient })
    .redis;

  fastify.pubsubSubscriber.onMessage(async (message) => {
    await handleBuyTicketMessage(message, {
      logger: fastify.log,
      executeBuyTicket: async (payload) => {
        await db.execute(
          sql`SELECT buy_ticket(${payload.eventId}, ${payload.firstName}, ${payload.lastName})`,
        );
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
    });
  });

  fastify.addHook("onReady", async () => {
    fastify.pubsubSubscriber.start();
  });
};

export default pubSubListenerRoutes;
