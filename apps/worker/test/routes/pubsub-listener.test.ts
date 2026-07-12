import * as assert from "node:assert";
import { test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import {
  completedOrderCacheEntrySchema,
  failedOrderCacheEntrySchema,
  type BuyTicketEvent,
  type FinalOrderCacheEntry,
} from "@repo/types/tickets";
import type { FailedOrderUpdateResult } from "@repo/db";
import {
  handleBuyTicketMessage,
  type BuyTicketMessageHandlerDeps,
} from "../../src/lib/handle-buy-ticket-message.ts";
import { createPubSubListenerRoutes } from "../../src/routes/pubsub-listener.ts";

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
): BuyTicketMessageHandlerDeps & { lockReleaseCalls: number } {
  const tracker = { lockReleaseCalls: 0 };

  return Object.assign(tracker, {
    logger: noopLogger,
    executeBuyTicket,
    compensateReservation,
    markOrderFailed: async (): Promise<FailedOrderUpdateResult> => "updated",
    beginOrderProcessing: async (): Promise<
      "duplicate" | "acquired" | "locked"
    > => "acquired",
    finalizeOrder: async () => undefined,
    releaseProcessingLock: async () => {
      tracker.lockReleaseCalls += 1;
    },
    sleep: async () => undefined,
    ...overrides,
  });
}

function createValidPayload(): BuyTicketEvent {
  return {
    orderId: "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23",
    eventId: "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b",
    firstName: "Max",
    lastName: "Mustermann",
    queuedAt: Date.now(),
  };
}

function createRouteTestFastify() {
  const hooks: Record<string, Array<() => Promise<void>>> = {};
  let registeredMessageHandler:
    | ((message: TestMessage) => Promise<void>)
    | undefined;
  const startCalls: string[] = [];

  const instance = {
    log: noopLogger,
    redis: {
      get: async () => null,
      set: async () => "OK" as const,
      del: async () => 0,
      incrby: async () => 0,
      defineCommand: () => undefined,
      scan: async () => ["0", []] as [string, string[]],
      mset: async () => "OK",
    },
    pubsubSubscriber: {
      onMessage(handler: (message: TestMessage) => Promise<void>) {
        registeredMessageHandler = handler;
      },
      start() {
        startCalls.push("start");
      },
      stop: async () => undefined,
    },
    addHook(name: string, hook: () => Promise<void>) {
      hooks[name] ??= [];
      hooks[name].push(hook);
    },
    async runHook(name: string) {
      for (const hook of hooks[name] ?? []) {
        await hook();
      }
    },
  };

  return {
    fastify: instance,
    getRegisteredMessageHandler: () => registeredMessageHandler,
    startCalls,
  };
}

void test("pubsub-listener reconciles ticket availability once before starting the subscriber", async () => {
  const startupOrder: string[] = [];
  let reconcileCalls = 0;
  let inventoryReads = 0;
  const { fastify, getRegisteredMessageHandler, startCalls } =
    createRouteTestFastify();

  const route = createPubSubListenerRoutes({
    executeBuyTicket: async () => "ticket-1",
    listEventInventorySnapshots: async () => {
      inventoryReads += 1;
      return [];
    },
    markOrderFailed: async () => "updated",
    reconcileTicketAvailability: async ({ getEventInventorySnapshots }) => {
      reconcileCalls += 1;
      startupOrder.push("reconcile");
      await getEventInventorySnapshots();
    },
  });

  fastify.pubsubSubscriber.start = () => {
    startupOrder.push("start");
    startCalls.push("start");
  };

  await route(fastify as never, {} as never);
  assert.equal(typeof getRegisteredMessageHandler(), "function");

  await fastify.runHook("onReady");

  assert.equal(reconcileCalls, 1);
  assert.equal(inventoryReads, 1);
  assert.deepEqual(startupOrder, ["reconcile", "start"]);
  assert.equal(startCalls.length, 1);
});

void test("pubsub-listener ACKs successful messages and finalizes atomically", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let executeCalls = 0;
  let finalizedEntry: FinalOrderCacheEntry | undefined;
  let e2eLatencyStatus: string | undefined;
  let e2eLatencySeconds: number | undefined;
  const ticketId = "2c4fd22c-f5be-4bf7-bb45-5019d92666ab";

  const deps = createDeps(
    async () => {
      executeCalls += 1;
      return ticketId;
    },
    async () => "already-released",
    {
      finalizeOrder: async (_payload, entry) => {
        finalizedEntry = entry;
      },
      metrics: {
        onE2eLatency: (_, durationSeconds, status) => {
          e2eLatencySeconds = durationSeconds;
          e2eLatencyStatus = status;
        },
      },
    },
  );

  await handleBuyTicketMessage(message, deps);

  assert.equal(executeCalls, 1);
  assert.deepEqual(
    finalizedEntry,
    completedOrderCacheEntrySchema.parse({
      orderId: "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23",
      eventId: "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b",
      status: "completed",
      ticketId,
    }),
  );
  assert.equal(message.acked, true);
  assert.equal(message.nacked, false);
  // finalizeOrder released the lock as part of its atomic script
  assert.equal(deps.lockReleaseCalls, 0);
  assert.equal(e2eLatencyStatus, "completed");
  assert.ok(
    typeof e2eLatencySeconds === "number" && e2eLatencySeconds >= 0,
    `expected e2eLatencySeconds >= 0, got ${String(e2eLatencySeconds)}`,
  );
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
        beginOrderProcessing: async () => "duplicate",
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
        beginOrderProcessing: async () => "locked",
      },
    ),
  );

  assert.equal(executeCalls, 0);
  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
});

void test("pubsub-listener NACKs messages and releases the lock when DB execution fails", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));

  const deps = createDeps(async () => {
    throw new Error("db unavailable");
  });

  await handleBuyTicketMessage(message, deps);

  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
  assert.equal(deps.lockReleaseCalls, 1);
});

void test("pubsub-listener compensates reservation and ACKs on terminal P0001 error", async () => {
  const payload = createValidPayload();
  const message = createMessage(JSON.stringify(payload));
  let compensationPayload: BuyTicketEvent | undefined;
  let failedOrderPayload: BuyTicketEvent | undefined;
  let receivedFailureReason: string | undefined;
  let finalizedEntry: FinalOrderCacheEntry | undefined;
  let e2eLatencyStatus: string | undefined;
  let e2eLatencySeconds: number | undefined;

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
        finalizeOrder: async (_payload, entry) => {
          finalizedEntry = entry;
        },
        metrics: {
          onE2eLatency: (_, durationSeconds, status) => {
            e2eLatencySeconds = durationSeconds;
            e2eLatencyStatus = status;
          },
        },
      },
    ),
  );

  assert.deepEqual(compensationPayload, payload);
  assert.deepEqual(failedOrderPayload, payload);
  assert.equal(receivedFailureReason, "event not found");
  assert.deepEqual(
    finalizedEntry,
    failedOrderCacheEntrySchema.parse({
      orderId: payload.orderId,
      eventId: payload.eventId,
      status: "failed",
      failureReason: "event not found",
    }),
  );
  assert.equal(message.acked, true);
  assert.equal(message.nacked, false);
  assert.equal(e2eLatencyStatus, "failed");
  assert.ok(
    typeof e2eLatencySeconds === "number" && e2eLatencySeconds >= 0,
    `expected e2eLatencySeconds >= 0, got ${String(e2eLatencySeconds)}`,
  );
});

void test("pubsub-listener ACKs terminal P0001 error when failed order row is missing", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let finalizeCalls = 0;

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
        finalizeOrder: async () => {
          finalizeCalls += 1;
        },
      },
    ),
  );

  assert.equal(finalizeCalls, 1);
  assert.equal(message.acked, true);
  assert.equal(message.nacked, false);
});

void test("pubsub-listener NACKs terminal P0001 error when compensation fails", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));

  const deps = createDeps(
    async () => {
      const cause = { code: "P0001" };
      throw new Error("event not found", { cause });
    },
    async () => {
      throw new Error("redis unavailable");
    },
  );

  await handleBuyTicketMessage(message, deps);

  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
  assert.equal(deps.lockReleaseCalls, 1);
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

void test("pubsub-listener NACKs terminal P0001 error when finalize fails", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));

  const deps = createDeps(
    async () => {
      const cause = { code: "P0001" };
      throw new Error("event not found", { cause });
    },
    async () => "released",
    {
      finalizeOrder: async () => {
        throw new Error("finalize write failed");
      },
    },
  );

  await handleBuyTicketMessage(message, deps);

  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
  assert.equal(deps.lockReleaseCalls, 1);
});

void test("pubsub-listener NACKs successful messages when finalize fails", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));

  const deps = createDeps(
    async () => "2c4fd22c-f5be-4bf7-bb45-5019d92666ab",
    async () => "already-released",
    {
      finalizeOrder: async () => {
        throw new Error("finalize write failed");
      },
    },
  );

  await handleBuyTicketMessage(message, deps);

  assert.equal(message.acked, false);
  assert.equal(message.nacked, true);
  assert.equal(deps.lockReleaseCalls, 1);
});
