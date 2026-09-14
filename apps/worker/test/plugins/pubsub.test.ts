import * as assert from "node:assert";
import { test } from "node:test";
import type { Message, PubSub, Subscription } from "@google-cloud/pubsub";
import { env } from "@repo/env";
import {
  type PubSubSubscriber,
  pubSubSubscriberPlugin,
} from "../../src/plugins/pubsub.ts";

function createFakeFastify() {
  const hooks: Record<string, Array<() => Promise<void>>> = {};
  const instance = {
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
      debug: () => undefined,
    },
    serviceHealth: {
      fatalReason: null as string | null,
      markFatal(reason: string) {
        instance.serviceHealth.fatalReason ??= reason;
      },
    },
    addHook(name: string, hook: () => Promise<void>) {
      hooks[name] ??= [];
      hooks[name].push(hook);
    },
    decorate(name: string, value: unknown) {
      Reflect.set(instance, name, value);
    },
    async runHook(name: string) {
      for (const hook of hooks[name] ?? []) {
        await hook();
      }
    },
  };

  return instance as typeof instance & {
    pubsubSubscriber: PubSubSubscriber;
  };
}

interface FakeMessage extends Partial<Message> {
  id: string;
  data: Buffer;
  ack: () => void;
  nack: () => void;
  acked?: boolean;
  nacked?: boolean;
}

function createFakeMessage(
  id: string,
  data: unknown,
): FakeMessage & { acked: boolean; nacked: boolean } {
  const msg: FakeMessage & { acked: boolean; nacked: boolean } = {
    id,
    data: Buffer.from(JSON.stringify(data)),
    acked: false,
    nacked: false,
    ack(this: FakeMessage & { acked: boolean; nacked: boolean }) {
      this.acked = true;
    },
    nack(this: FakeMessage & { acked: boolean; nacked: boolean }) {
      this.nacked = true;
    },
  };
  return msg;
}

type ListenerRegistry = {
  message: Array<(message: Message) => void | Promise<void>>;
  error: Array<(error: Error) => void>;
};

function createListenerRegistry(): ListenerRegistry {
  return {
    message: [],
    error: [],
  };
}

function createSubscriptionMock(
  listeners: ListenerRegistry,
  exists = true,
  onClose?: () => void | Promise<void>,
): Subscription {
  function on(
    event: "message",
    listener: (message: Message) => void | Promise<void>,
  ): void;
  function on(event: "error", listener: (error: Error) => void): void;
  function on(
    event: "message" | "error",
    listener:
      | ((message: Message) => void | Promise<void>)
      | ((error: Error) => void),
  ): void {
    if (event === "message") {
      listeners.message.push(
        listener as (message: Message) => void | Promise<void>,
      );
      return;
    }

    listeners.error.push(listener as (error: Error) => void);
  }

  return {
    on,
    exists() {
      return Promise.resolve([exists]);
    },
    removeListener(event: "message" | "error", listener: unknown) {
      const registered = listeners[event] as unknown[];
      const index = registered.indexOf(listener);
      if (index !== -1) registered.splice(index, 1);
    },
    removeAllListeners() {
      listeners.message = [];
      listeners.error = [];
    },
    async close() {
      // Der Drain laeuft hier: was `close()` noch sieht, sieht auch der echte
      // Subscriber waehrend `SubscriberCloseBehaviors.WaitForProcessing`.
      await onClose?.();
    },
  } as unknown as Subscription;
}

interface CapturedSubscriptionOptions {
  name?: string;
  options?: {
    flowControl?: { maxMessages?: number };
    closeOptions?: { behavior?: string; timeout?: { milliseconds: number } };
  };
}

function createClientMock(
  subscription: Subscription,
  captured: CapturedSubscriptionOptions = {},
): PubSub {
  return {
    subscription(
      name: string,
      options: CapturedSubscriptionOptions["options"],
    ) {
      captured.name = name;
      captured.options = options;
      return subscription;
    },
  } as unknown as PubSub;
}

async function deliverMessage(
  listeners: ListenerRegistry,
  message: Message,
): Promise<void> {
  await Promise.all(listeners.message.map((listener) => listener(message)));
}

void test("pubsub subscriber plugin decorates fastify with subscriber methods", async () => {
  const listeners = createListenerRegistry();
  const fakeSubscription = createSubscriptionMock(listeners);
  const fakeClient = createClientMock(fakeSubscription);

  const fastify = createFakeFastify();
  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    onFatal: () => {},
  });

  assert.ok(fastify.pubsubSubscriber);
  assert.equal(typeof fastify.pubsubSubscriber.onMessage, "function");
  assert.equal(typeof fastify.pubsubSubscriber.start, "function");
  assert.equal(typeof fastify.pubsubSubscriber.stop, "function");
});

void test("pubsub subscriber processes messages through registered handler", async () => {
  const listeners = createListenerRegistry();
  const fakeSubscription = createSubscriptionMock(listeners);
  const fakeClient = createClientMock(fakeSubscription);

  const fastify = createFakeFastify();
  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    onFatal: () => {},
  });

  const receivedMessages: unknown[] = [];

  fastify.pubsubSubscriber.onMessage(async (message: Message) => {
    receivedMessages.push(JSON.parse(message.data.toString("utf8")));
    message.ack();
  });

  fastify.pubsubSubscriber.start();

  const fakeMessage = createFakeMessage("msg-1", { userId: "user-123" });
  await deliverMessage(listeners, fakeMessage as unknown as Message);

  assert.equal(receivedMessages.length, 1);
  assert.deepEqual(receivedMessages[0], { userId: "user-123" });
  assert.ok(fakeMessage.acked);
  assert.ok(!fakeMessage.nacked);

  await fastify.pubsubSubscriber.stop();
});

void test("pubsub subscriber nacks messages when handler throws", async () => {
  const listeners = createListenerRegistry();
  const fakeSubscription = createSubscriptionMock(listeners);
  const fakeClient = createClientMock(fakeSubscription);

  const fastify = createFakeFastify();
  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    onFatal: () => {},
  });

  fastify.pubsubSubscriber.onMessage(async () => {
    throw new Error("Processing failed");
  });

  fastify.pubsubSubscriber.start();

  const fakeMessage = createFakeMessage("msg-1", { userId: "user-123" });
  await deliverMessage(listeners, fakeMessage as unknown as Message);

  assert.ok(!fakeMessage.acked);
  assert.ok(fakeMessage.nacked);

  await fastify.pubsubSubscriber.stop();
});

async function deliverError(
  listeners: ListenerRegistry,
  error: Error,
): Promise<void> {
  for (const listener of listeners.error) listener(error);
  await Promise.resolve();
}

void test("a permanent subscription error marks the worker unhealthy", async () => {
  const listeners = createListenerRegistry();
  const fakeClient = createClientMock(createSubscriptionMock(listeners));
  const fastify = createFakeFastify();

  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    onFatal: () => {},
  });
  fastify.pubsubSubscriber.start();

  // Exakt der Fehler vom 2026-09-09: der Streaming-Pull stirbt endgueltig,
  // der Prozess laeuft weiter und verarbeitet nichts mehr.
  await deliverError(
    listeners,
    Object.assign(new Error("Subscription does not exist"), { code: 5 }),
  );

  assert.match(
    fastify.serviceHealth.fatalReason ?? "",
    /permanently unavailable \(NOT_FOUND\)/,
  );
});

void test("a transient subscription error leaves the worker healthy", async () => {
  const listeners = createListenerRegistry();
  const fakeClient = createClientMock(createSubscriptionMock(listeners));
  const fastify = createFakeFastify();

  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    onFatal: () => {},
  });
  fastify.pubsubSubscriber.start();

  // UNAVAILABLE (14): der Client stellt den Stream selbst wieder her.
  await deliverError(
    listeners,
    Object.assign(new Error("503 UNAVAILABLE"), { code: 14 }),
  );

  assert.equal(fastify.serviceHealth.fatalReason, null);
});

void test("a permanent subscription error shuts the worker down so it gets restarted", async () => {
  let fatalCalls = 0;
  const listeners = createListenerRegistry();
  const fakeClient = createClientMock(createSubscriptionMock(listeners));
  const fastify = createFakeFastify();

  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    onFatal: () => {
      fatalCalls += 1;
    },
  });
  fastify.pubsubSubscriber.start();

  await deliverError(
    listeners,
    Object.assign(new Error("Subscription does not exist"), { code: 5 }),
  );

  // Nur das Prozess-Ende loest einen Neustart aus — Docker reagiert nicht auf
  // Healthchecks, und lokal gibt es keine Liveness-Probe (ADR-044).
  assert.equal(fatalCalls, 1);
});

void test("a transient subscription error does not shut the worker down", async () => {
  let fatalCalls = 0;
  const listeners = createListenerRegistry();
  const fakeClient = createClientMock(createSubscriptionMock(listeners));
  const fastify = createFakeFastify();

  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    onFatal: () => {
      fatalCalls += 1;
    },
  });
  fastify.pubsubSubscriber.start();

  await deliverError(
    listeners,
    Object.assign(new Error("503 UNAVAILABLE"), { code: 14 }),
  );

  assert.equal(fatalCalls, 0);
});

void test("the subscriber is configured to drain in-flight messages on close", async () => {
  const listeners = createListenerRegistry();
  const captured: CapturedSubscriptionOptions = {};
  const fakeClient = createClientMock(
    createSubscriptionMock(listeners),
    captured,
  );
  const fastify = createFakeFastify();

  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    onFatal: () => {},
  });

  // Ohne "WAIT" nackt die Library beim Schliessen jede bereits zugestellte
  // Nachricht sofort — bei jedem Rolling Update ein Redelivery-Ausschlag.
  assert.equal(captured.options?.closeOptions?.behavior, "WAIT");
  assert.equal(
    captured.options?.closeOptions?.timeout?.milliseconds,
    env.WORKER_SHUTDOWN_DRAIN_TIMEOUT_SECONDS * 1000,
  );
});

void test("a stream error during shutdown does not count as a permanent failure", async () => {
  let fatalCalls = 0;
  const listeners = createListenerRegistry();
  // `close()` zerstoert den Streaming-Pull; der Fehler, den er dabei meldet,
  // darf den Prozess nicht mitten im Drain beenden.
  const fakeSubscription = createSubscriptionMock(listeners, true, async () => {
    await deliverError(
      listeners,
      Object.assign(new Error("Subscription does not exist"), { code: 5 }),
    );
  });
  const fastify = createFakeFastify();

  await pubSubSubscriberPlugin(fastify as never, {
    client: createClientMock(fakeSubscription),
    subscriptionName: "buy-ticket-worker",
    onFatal: () => {
      fatalCalls += 1;
    },
  });
  fastify.pubsubSubscriber.start();

  await fastify.pubsubSubscriber.stop();

  assert.equal(fatalCalls, 0);
  assert.equal(fastify.serviceHealth.fatalReason, null);
});
