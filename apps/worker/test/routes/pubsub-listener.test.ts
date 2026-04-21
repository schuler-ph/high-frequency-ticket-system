import * as assert from "node:assert";
import { test } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { BuyTicketEvent } from "@repo/types/tickets";
import type { FailedOrderUpdateResult } from "@repo/db";
import {
  handleBuyTicketMessage,
  type BuyTicketMessageHandlerDeps,
} from "../../src/lib/handle-buy-ticket-message.js";

type TestMessage = {
  id: string;
  data: Buffer;
  acked: boolean;
  nacked: boolean;
  ack: () => void;
  nack: () => void;
};

const noopLogger: FastifyBaseLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  silent: () => undefined,
  child: () => noopLogger,
  level: "info",
} as unknown as FastifyBaseLogger;

function createMessage(payload: string): TestMessage {
  const message: TestMessage = {
    id: "msg-1",
    data: Buffer.from(payload),
    acked: false,
    nacked: false,
    ack() {
      message.acked = true;
    },
    nack() {
      message.nacked = true;
    },
  };

  return message;
}

function createDeps(
  executeBuyTicket: BuyTicketMessageHandlerDeps["executeBuyTicket"],
  compensateReservation: BuyTicketMessageHandlerDeps["compensateReservation"] = async () =>
    "already-released",
  overrides: Partial<BuyTicketMessageHandlerDeps> = {},
): BuyTicketMessageHandlerDeps {
  return {
    logger: noopLogger,
    executeBuyTicket,
    compensateReservation,
    markOrderFailed: async (): Promise<FailedOrderUpdateResult> => "updated",
    isOrderProcessed: async () => false,
    tryAcquireProcessingLock: async () => true,
    markOrderProcessed: async () => undefined,
    releaseProcessingLock: async () => undefined,
    sleep: async () => undefined,
    ...overrides,
  };
}

function createValidPayload(): BuyTicketEvent {
  return {
    orderId: "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23",
    eventId: "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b",
    firstName: "Max",
    lastName: "Mustermann",
  };
}

void test("pubsub-listener ACKs successful messages", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let executeCalls = 0;
  let markedProcessed = 0;

  await handleBuyTicketMessage(
    message,
    createDeps(
      async () => {
        executeCalls += 1;
        return "ticket-1";
      },
      async () => "already-released",
      {
        markOrderProcessed: async () => {
          markedProcessed += 1;
        },
      },
    ),
  );

  assert.equal(executeCalls, 1);
  assert.equal(markedProcessed, 1);
  assert.equal(message.acked, true);
  assert.equal(message.nacked, false);
});

void test("pubsub-listener ACKs and skips duplicate already-processed messages", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let executeCalls = 0;

  await handleBuyTicketMessage(
    message,
    createDeps(
      async () => {
        executeCalls += 1;
        return "ticket-1";
      },
      async () => "already-released",
      {
        isOrderProcessed: async () => true,
      },
    ),
  );

  assert.equal(executeCalls, 0);
  assert.equal(message.acked, true);
  assert.equal(message.nacked, false);
});

void test("pubsub-listener NACKs when processing lock cannot be acquired", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let executeCalls = 0;

  await handleBuyTicketMessage(
    message,
    createDeps(
      async () => {
        executeCalls += 1;
        return "ticket-1";
      },
      async () => "already-released",
      {
        tryAcquireProcessingLock: async () => false,
      },
    ),
  );

  assert.equal(executeCalls, 0);
  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
});

void test("pubsub-listener NACKs messages when DB execution fails", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));

  await handleBuyTicketMessage(
    message,
    createDeps(async () => {
      throw new Error("db unavailable");
    }),
  );

  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
});

void test("pubsub-listener compensates reservation and ACKs on terminal P0001 error", async () => {
  const payload = createValidPayload();
  const message = createMessage(JSON.stringify(payload));
  let compensationPayload: BuyTicketEvent | undefined;
  let failedOrderPayload: BuyTicketEvent | undefined;
  let receivedFailureReason: string | undefined;
  let markedProcessed = 0;

  await handleBuyTicketMessage(
    message,
    createDeps(
      async () => {
        const cause = { code: "P0001" };
        throw new Error("event not found", { cause });
      },
      async (receivedPayload) => {
        compensationPayload = receivedPayload;
        return "released";
      },
      {
        markOrderFailed: async (receivedPayload, failureReason) => {
          failedOrderPayload = receivedPayload;
          receivedFailureReason = failureReason;
          return "updated";
        },
        markOrderProcessed: async () => {
          markedProcessed += 1;
        },
      },
    ),
  );

  assert.deepEqual(compensationPayload, payload);
  assert.deepEqual(failedOrderPayload, payload);
  assert.equal(receivedFailureReason, "event not found");
  assert.equal(markedProcessed, 1);
  assert.equal(message.acked, true);
  assert.equal(message.nacked, false);
});

void test("pubsub-listener ACKs terminal P0001 error when failed order row is missing", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let markedProcessed = 0;

  await handleBuyTicketMessage(
    message,
    createDeps(
      async () => {
        const cause = { code: "P0001" };
        throw new Error("event not found", { cause });
      },
      async () => "already-released",
      {
        markOrderFailed: async () => "missing",
        markOrderProcessed: async () => {
          markedProcessed += 1;
        },
      },
    ),
  );

  assert.equal(markedProcessed, 1);
  assert.equal(message.acked, true);
  assert.equal(message.nacked, false);
});

void test("pubsub-listener NACKs terminal P0001 error when compensation fails", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));

  await handleBuyTicketMessage(
    message,
    createDeps(
      async () => {
        const cause = { code: "P0001" };
        throw new Error("event not found", { cause });
      },
      async () => {
        throw new Error("redis unavailable");
      },
    ),
  );

  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
});

void test("pubsub-listener NACKs terminal P0001 error when failed order update fails", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));

  await handleBuyTicketMessage(
    message,
    createDeps(
      async () => {
        const cause = { code: "P0001" };
        throw new Error("event not found", { cause });
      },
      async () => "released",
      {
        markOrderFailed: async () => {
          throw new Error("failed order write failed");
        },
      },
    ),
  );

  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
});

void test("pubsub-listener NACKs invalid JSON payloads", async () => {
  const message = createMessage("{invalid-json");

  await handleBuyTicketMessage(
    message,
    createDeps(async () => {
      throw new Error("must not be called");
    }),
  );

  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
});

void test("pubsub-listener NACKs payloads that fail schema validation", async () => {
  const invalidPayload = {
    orderId: "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23",
    firstName: "Max",
    lastName: "Mustermann",
  };
  const message = createMessage(JSON.stringify(invalidPayload));
  let executeCalls = 0;

  await handleBuyTicketMessage(
    message,
    createDeps(async () => {
      executeCalls += 1;
      return "ticket-1";
    }),
  );

  assert.equal(executeCalls, 0);
  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
});

void test("pubsub-listener NACKs terminal P0001 error when marking processed fails", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));

  await handleBuyTicketMessage(
    message,
    createDeps(
      async () => {
        const cause = { code: "P0001" };
        throw new Error("event not found", { cause });
      },
      async () => "released",
      {
        markOrderProcessed: async () => {
          throw new Error("processed marker write failed");
        },
      },
    ),
  );

  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
});
