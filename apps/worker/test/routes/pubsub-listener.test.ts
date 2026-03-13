import * as assert from "node:assert";
import { test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { BuyTicketRequest } from "@repo/types/tickets";
import {
  handleBuyTicketMessage,
  type BuyTicketMessageHandlerDeps,
} from "../../src/routes/pubsub-listener.js";

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
): BuyTicketMessageHandlerDeps {
  return {
    logger: noopLogger,
    executeBuyTicket,
    sleep: async () => undefined,
  };
}

function createValidPayload(): BuyTicketRequest {
  return {
    eventId: "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b",
    firstName: "Max",
    lastName: "Mustermann",
  };
}

void test("pubsub-listener ACKs successful messages", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let executeCalls = 0;

  await handleBuyTicketMessage(
    message,
    createDeps(async () => {
      executeCalls += 1;
    }),
  );

  assert.equal(executeCalls, 1);
  assert.equal(message.acked, true);
  assert.equal(message.nacked, false);
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
