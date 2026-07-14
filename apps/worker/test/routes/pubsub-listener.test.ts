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
  type BuyTicketOutcome,
} from "../../src/lib/handle-buy-ticket-message.ts";
import {
  applyBuyTicketOutcome,
  buyTicketOutcomePolicy,
  createPubSubListenerRoutes,
} from "../../src/routes/pubsub-listener.ts";

type TestMessage = {
  id: string;
  data: Buffer;
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
  return {
    id: "msg-1",
    data: Buffer.from(payload),
  };
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
    | ((
        message: TestMessage & { ack: () => void; nack: () => void },
      ) => Promise<void>)
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
      // registerWorkerRedisScripts castet den Client — die per defineCommand
      // erzeugten Command-Methoden muss der Fake selbst mitbringen.
      beginOrderProcessing: async () => "acquired" as const,
      finalizeOrderProcessing: async () => 1,
      compensateReservation: async () => 0,
    },
    pubsubSubscriber: {
      onMessage(
        handler: (
          message: TestMessage & { ack: () => void; nack: () => void },
        ) => Promise<void>,
      ) {
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

// --- Outcome-Policy: die ACK/NACK-Tabelle aus ARCHITECTURE.md als Assertion ---

void test("outcome policy encodes the documented ACK/NACK table exactly", () => {
  const ackByKind = Object.fromEntries(
    Object.entries(buyTicketOutcomePolicy).map(([kind, policy]) => [
      kind,
      policy.ack,
    ]),
  );

  assert.deepEqual(ackByKind, {
    completed: true,
    duplicate: true,
    "lock-conflict": false,
    "invalid-payload": false,
    "terminal-failed": true,
    "compensation-failed": false,
    "transient-error": false,
  });
});

void test("applyBuyTicketOutcome ACKs exactly once for ack-outcomes and NACKs otherwise", () => {
  const outcomes: BuyTicketOutcome[] = [
    { kind: "completed", eventId: "e-1", queuedAt: Date.now() },
    { kind: "duplicate", eventId: "e-1" },
    { kind: "lock-conflict", eventId: "e-1" },
    { kind: "invalid-payload" },
    { kind: "terminal-failed", eventId: "e-1", queuedAt: Date.now() },
    { kind: "compensation-failed", eventId: "e-1" },
    { kind: "transient-error", eventId: "e-1" },
  ];

  for (const outcome of outcomes) {
    let acked = 0;
    let nacked = 0;

    applyBuyTicketOutcome(
      {
        ack: () => {
          acked += 1;
        },
        nack: () => {
          nacked += 1;
        },
      },
      outcome,
    );

    const expectedAck = buyTicketOutcomePolicy[outcome.kind].ack;
    assert.equal(acked, expectedAck ? 1 : 0, `ack count for ${outcome.kind}`);
    assert.equal(nacked, expectedAck ? 0 : 1, `nack count for ${outcome.kind}`);
  }
});

// --- Listener-Verdrahtung ---

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

void test("pubsub-listener message handler applies the outcome policy (completed → ACK)", async () => {
  const { fastify, getRegisteredMessageHandler } = createRouteTestFastify();

  const route = createPubSubListenerRoutes({
    executeBuyTicket: async () => "2c4fd22c-f5be-4bf7-bb45-5019d92666ab",
    listEventInventorySnapshots: async () => [],
    markOrderFailed: async () => "updated",
    reconcileTicketAvailability: async () => undefined,
  });

  await route(fastify as never, {} as never);

  const handler = getRegisteredMessageHandler();
  assert.ok(handler);

  let acked = 0;
  let nacked = 0;
  await handler({
    ...createMessage(JSON.stringify(createValidPayload())),
    ack: () => {
      acked += 1;
    },
    nack: () => {
      nacked += 1;
    },
  });

  assert.equal(acked, 1);
  assert.equal(nacked, 0);
});

// --- Handler-Outcomes pro Szenario ---

void test("handler returns completed outcome and finalizes atomically on success", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let executeCalls = 0;
  let finalizedEntry: FinalOrderCacheEntry | undefined;
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
    },
  );

  const outcome = await handleBuyTicketMessage(message, deps);

  assert.equal(executeCalls, 1);
  assert.equal(outcome.kind, "completed");
  assert.ok(outcome.kind === "completed");
  assert.equal(outcome.eventId, "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b");
  assert.ok(outcome.queuedAt > 0);
  assert.deepEqual(
    finalizedEntry,
    completedOrderCacheEntrySchema.parse({
      orderId: "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23",
      eventId: "d18f2ce4-5f31-4ec1-bfd6-b3525fd4676b",
      status: "completed",
      ticketId,
    }),
  );
  // finalizeOrder released the lock as part of its atomic script
  assert.equal(deps.lockReleaseCalls, 0);
});

void test("handler returns duplicate outcome for already-processed messages", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let executeCalls = 0;

  const outcome = await handleBuyTicketMessage(
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
  assert.equal(outcome.kind, "duplicate");
});

void test("handler returns lock-conflict outcome when the processing lock is held", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let executeCalls = 0;

  const outcome = await handleBuyTicketMessage(
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
  assert.equal(outcome.kind, "lock-conflict");
});

void test("handler returns transient-error outcome and releases the lock when DB execution fails", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));

  const deps = createDeps(async () => {
    throw new Error("db unavailable");
  });

  const outcome = await handleBuyTicketMessage(message, deps);

  assert.equal(outcome.kind, "transient-error");
  assert.equal(deps.lockReleaseCalls, 1);
});

void test("handler compensates reservation and returns terminal-failed outcome on P0001", async () => {
  const payload = createValidPayload();
  const message = createMessage(JSON.stringify(payload));
  let compensationPayload: BuyTicketEvent | undefined;
  let failedOrderPayload: BuyTicketEvent | undefined;
  let receivedFailureReason: string | undefined;
  let finalizedEntry: FinalOrderCacheEntry | undefined;

  const outcome = await handleBuyTicketMessage(
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
  assert.equal(outcome.kind, "terminal-failed");
});

void test("handler returns terminal-failed outcome on P0001 when failed order row is missing", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));
  let finalizeCalls = 0;

  const outcome = await handleBuyTicketMessage(
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
  assert.equal(outcome.kind, "terminal-failed");
});

void test("handler returns compensation-failed outcome when compensation fails on P0001", async () => {
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

  const outcome = await handleBuyTicketMessage(message, deps);

  assert.equal(outcome.kind, "compensation-failed");
  assert.equal(deps.lockReleaseCalls, 1);
});

void test("handler returns compensation-failed outcome when failed order update fails", async () => {
  const message = createMessage(JSON.stringify(createValidPayload()));

  const outcome = await handleBuyTicketMessage(
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

  assert.equal(outcome.kind, "compensation-failed");
});

void test("handler returns invalid-payload outcome for invalid JSON", async () => {
  const message = createMessage("{invalid-json");

  const outcome = await handleBuyTicketMessage(
    message,
    createDeps(async () => {
      throw new Error("must not be called");
    }),
  );

  assert.equal(outcome.kind, "invalid-payload");
});

void test("handler returns invalid-payload outcome for schema violations", async () => {
  const invalidPayload = {
    orderId: "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23",
    firstName: "Max",
    lastName: "Mustermann",
  };
  const message = createMessage(JSON.stringify(invalidPayload));
  let executeCalls = 0;

  const outcome = await handleBuyTicketMessage(
    message,
    createDeps(async () => {
      executeCalls += 1;
      return "ticket-1";
    }),
  );

  assert.equal(executeCalls, 0);
  assert.equal(outcome.kind, "invalid-payload");
});

void test("handler returns compensation-failed outcome when finalize fails on P0001", async () => {
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

  const outcome = await handleBuyTicketMessage(message, deps);

  assert.equal(outcome.kind, "compensation-failed");
  assert.equal(deps.lockReleaseCalls, 1);
});

void test("handler returns transient-error outcome when finalize fails on the success path", async () => {
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

  const outcome = await handleBuyTicketMessage(message, deps);

  assert.equal(outcome.kind, "transient-error");
  assert.equal(deps.lockReleaseCalls, 1);
});
