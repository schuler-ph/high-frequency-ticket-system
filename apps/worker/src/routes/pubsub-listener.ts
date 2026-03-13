import { setTimeout } from "node:timers/promises";
import type { Message } from "@google-cloud/pubsub";
import type { FastifyPluginAsync } from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "@repo/db";
import {
  buyTicketRequestSchema,
  type BuyTicketRequest,
} from "@repo/types/tickets";
import type {} from "../plugins/pubsub.js";

type BuyTicketMessage = Pick<Message, "id" | "data" | "ack" | "nack">;

type BuyTicketPayload = BuyTicketRequest;

export type BuyTicketMessageHandlerDeps = {
  logger: FastifyBaseLogger;
  executeBuyTicket: (payload: BuyTicketPayload) => Promise<void>;
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

  const parsed = buyTicketRequestSchema.safeParse(payload);
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
      deps.logger.warn(
        { messageId: message.id, eventId: parsed.data.eventId, error },
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
  fastify.pubsubSubscriber.onMessage(async (message) => {
    await handleBuyTicketMessage(message, {
      logger: fastify.log,
      executeBuyTicket: async (payload) => {
        await db.execute(
          sql`SELECT buy_ticket(${payload.eventId}, ${payload.firstName}, ${payload.lastName})`,
        );
      },
    });
  });

  fastify.addHook("onReady", async () => {
    fastify.pubsubSubscriber.start();
  });
};

export default pubSubListenerRoutes;
