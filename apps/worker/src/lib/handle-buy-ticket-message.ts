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

type BuyTicketMessage = Pick<Message, "id" | "data">;

type BuyTicketPayload = BuyTicketEvent;

type CompensationResult = "released" | "already-released";

type OrderProcessingBegin = "duplicate" | "acquired" | "locked";

/**
 * Ergebnis der Message-Verarbeitung. Der Handler fasst weder ack/nack noch
 * Metriken an — er berechnet nur diesen Wert. Das Mapping Outcome →
 * ACK/NACK + Counter lebt als Tabelle im Listener (`buyTicketOutcomePolicy`)
 * und entspricht 1:1 der ACK/NACK-Tabelle in `docs/ARCHITECTURE.md`.
 */
export type BuyTicketOutcome =
  | { kind: "completed"; eventId: string; queuedAt: number }
  | { kind: "duplicate"; eventId: string }
  | { kind: "lock-conflict"; eventId: string }
  | { kind: "invalid-payload" }
  | { kind: "terminal-failed"; eventId: string; queuedAt: number }
  | { kind: "compensation-failed"; eventId: string }
  | { kind: "transient-error"; eventId: string };

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
): Promise<BuyTicketOutcome> {
  const rawPayload = message.data?.toString("utf8") ?? "";

  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch (error) {
    deps.logger.warn(
      { messageId: message.id, error },
      "Invalid BuyTicketEvent payload JSON",
    );
    return { kind: "invalid-payload" };
  }

  const parsed = buyTicketEventSchema.safeParse(payload);
  if (!parsed.success) {
    deps.logger.warn(
      { messageId: message.id, issues: parsed.error.issues },
      "BuyTicketEvent payload failed validation",
    );
    return { kind: "invalid-payload" };
  }

  const { eventId, orderId, queuedAt } = parsed.data;

  deps.logger.info(
    { messageId: message.id, eventId },
    "Received BuyTicketEvent",
  );

  const begin = await deps.beginOrderProcessing(parsed.data);

  if (begin === "duplicate") {
    deps.logger.info(
      { messageId: message.id, eventId, orderId },
      "Skipping already processed BuyTicketEvent",
    );
    return { kind: "duplicate", eventId };
  }

  if (begin === "locked") {
    deps.logger.warn(
      { messageId: message.id, eventId, orderId },
      "BuyTicketEvent is already being processed, nacking for redelivery",
    );
    return { kind: "lock-conflict", eventId };
  }

  // finalizeOrder gibt den Processing-Lock atomar mit frei; das finally
  // muss ihn nur auf Fehlerpfaden vor der Finalisierung freigeben.
  let finalized = false;

  try {
    await (deps.sleep ?? setTimeout)(1000);

    const ticketId = await deps.executeBuyTicket(parsed.data);
    await deps.finalizeOrder(parsed.data, {
      orderId,
      eventId,
      status: "completed",
      ticketId,
    } satisfies CompletedOrderCacheEntry);
    finalized = true;

    deps.logger.info(
      { messageId: message.id, eventId, orderId, ticketId },
      "Successfully processed BuyTicketEvent",
    );

    return { kind: "completed", eventId, queuedAt };
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
          orderId,
          eventId,
          status: "failed",
          failureReason,
        } satisfies FailedOrderCacheEntry);
        finalized = true;
      } catch (compensationError) {
        deps.logger.error(
          {
            messageId: message.id,
            eventId,
            orderId,
            error,
            compensationError,
          },
          "Failed to compensate reservation or persist failed order after terminal BuyTicketEvent error",
        );
        return { kind: "compensation-failed", eventId };
      }

      deps.logger.warn(
        {
          messageId: message.id,
          eventId,
          orderId,
          compensation: compensationResult,
          failedOrderUpdate,
          failureReason,
          error,
        },
        "Compensated reservation after terminal BuyTicketEvent error",
      );

      return { kind: "terminal-failed", eventId, queuedAt };
    }

    deps.logger.error(
      { messageId: message.id, eventId, error },
      "Error processing BuyTicketEvent",
    );
    return { kind: "transient-error", eventId };
  } finally {
    if (!finalized) {
      try {
        await deps.releaseProcessingLock(parsed.data);
      } catch (lockReleaseError) {
        deps.logger.error(
          { messageId: message.id, eventId, orderId, lockReleaseError },
          "Failed to release BuyTicketEvent processing lock",
        );
      }
    }
  }
}
