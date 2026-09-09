import * as assert from "node:assert";
import { test } from "node:test";
import type { Message, PubSub, Subscription } from "@google-cloud/pubsub";
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
    removeAllListeners() {
      listeners.message = [];
      listeners.error = [];
    },
    close() {
      return Promise.resolve();
    },
  } as unknown as Subscription;
}

function createClientMock(subscription: Subscription): PubSub {
  return {
    subscription() {
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
