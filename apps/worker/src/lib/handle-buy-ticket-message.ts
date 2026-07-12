import { setTimeout } from "node:timers/promises";
import type { Message } from "@google-cloud/pubsub";
import type { FastifyBaseLogger } from "fastify";
import {
  buyTicketEventSchema,
  type BuyTicketEvent,
  type CompletedOrderCacheEntry,
  type FailedOrderCacheEntry,
  type FinalOrderCacheEntry,
} from "@repo/types/tickets";
import type { FailedOrderUpdateResult } from "@repo/db";

type BuyTicketMessage = Pick<Message, "id" | "data" | "ack" | "nack">;

type BuyTicketPayload = BuyTicketEvent;

type CompensationResult = "released" | "already-released";

type OrderProcessingBegin = "duplicate" | "acquired" | "locked";

type MessageHandlerMetrics = {
  onOrderCompleted?: (eventId: string) => void;
  onOrderFailed?: (eventId: string) => void;
  onCompensation?: (eventId: string) => void;
  onRedelivery?: (eventId: string) => void;
  onIdempotencyHit?: (eventId: string) => void;
  onLockConflict?: (eventId: string) => void;
  onE2eLatency?: (
    eventId: string,
    durationSeconds: number,
    status: "completed" | "failed",
  ) => void;
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
  beginOrderProcessing: (
    payload: BuyTicketPayload,
  ) => Promise<OrderProcessingBegin>;
  finalizeOrder: (
    payload: BuyTicketPayload,
    entry: FinalOrderCacheEntry,
  ) => Promise<void>;
  releaseProcessingLock: (payload: BuyTicketPayload) => Promise<void>;
  sleep?: (ms: number) => Promise<unknown>;
  metrics?: MessageHandlerMetrics;
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

  const begin = await deps.beginOrderProcessing(parsed.data);

  if (begin === "duplicate") {
    deps.logger.info(
      {
        messageId: message.id,
        eventId: parsed.data.eventId,
        orderId: parsed.data.orderId,
      },
      "Skipping already processed BuyTicketEvent",
    );
    deps.metrics?.onIdempotencyHit?.(parsed.data.eventId);
    message.ack();
    return;
  }

  if (begin === "locked") {
    deps.logger.warn(
      {
        messageId: message.id,
        eventId: parsed.data.eventId,
        orderId: parsed.data.orderId,
      },
      "BuyTicketEvent is already being processed, nacking for redelivery",
    );
    deps.metrics?.onLockConflict?.(parsed.data.eventId);
    deps.metrics?.onRedelivery?.(parsed.data.eventId);
    message.nack();
    return;
  }

  // finalizeOrder gibt den Processing-Lock atomar mit frei; das finally
  // muss ihn nur auf Fehlerpfaden vor der Finalisierung freigeben.
  let finalized = false;

  try {
    await (deps.sleep ?? setTimeout)(1000);

    const ticketId = await deps.executeBuyTicket(parsed.data);
    await deps.finalizeOrder(parsed.data, {
      orderId: parsed.data.orderId,
      eventId: parsed.data.eventId,
      status: "completed",
      ticketId,
    } satisfies CompletedOrderCacheEntry);
    finalized = true;

    deps.logger.info(
      {
        messageId: message.id,
        eventId: parsed.data.eventId,
        orderId: parsed.data.orderId,
        ticketId,
      },
      "Successfully processed BuyTicketEvent",
    );

    deps.metrics?.onOrderCompleted?.(parsed.data.eventId);
    deps.metrics?.onE2eLatency?.(
      parsed.data.eventId,
      (Date.now() - parsed.data.queuedAt) / 1000,
      "completed",
    );
    message.ack();
    return;
  } catch (error) {
    if (getCauseCode(error) === "P0001") {
      const failureReason = getFailureReason(error);
      let compensationResult: CompensationResult;
      let failedOrderUpdate: FailedOrderUpdateResult;

      try {
        compensationResult = await deps.compensateReservation(parsed.data);
        failedOrderUpdate = await deps.markOrderFailed(
          parsed.data,
          failureReason,
        );
        await deps.finalizeOrder(parsed.data, {
          orderId: parsed.data.orderId,
          eventId: parsed.data.eventId,
          status: "failed",
          failureReason,
        } satisfies FailedOrderCacheEntry);
        finalized = true;
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

      deps.logger.warn(
        {
          messageId: message.id,
          eventId: parsed.data.eventId,
          orderId: parsed.data.orderId,
          compensation: compensationResult,
          failedOrderUpdate,
          failureReason,
          error,
        },
        "Compensated reservation after terminal BuyTicketEvent error",
      );

      deps.metrics?.onCompensation?.(parsed.data.eventId);
      deps.metrics?.onOrderFailed?.(parsed.data.eventId);
      deps.metrics?.onE2eLatency?.(
        parsed.data.eventId,
        (Date.now() - parsed.data.queuedAt) / 1000,
        "failed",
      );
      message.ack();
      return;
    }

    deps.logger.error(
      { messageId: message.id, eventId: parsed.data.eventId, error },
      "Error processing BuyTicketEvent",
    );
    deps.metrics?.onRedelivery?.(parsed.data.eventId);
    message.nack();
    return;
  } finally {
    if (!finalized) {
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
}
