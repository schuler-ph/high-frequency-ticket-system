import { setTimeout } from "node:timers/promises";
import type { Message } from "@google-cloud/pubsub";
import type { FastifyBaseLogger } from "fastify";
import { buyTicketEventSchema, type BuyTicketEvent } from "@repo/types/tickets";
import type { FailedOrderUpdateResult } from "@repo/db";

type BuyTicketMessage = Pick<Message, "id" | "data" | "ack" | "nack">;

type BuyTicketPayload = BuyTicketEvent;

type CompensationResult = "released" | "already-released";

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
