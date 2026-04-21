import * as assert from "node:assert";
import { test } from "node:test";
import type { Message } from "@google-cloud/pubsub";
import {
  type PubSubClientLike,
  type SubscriptionLike,
  type TopicLike,
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
  exists: boolean,
): SubscriptionLike {
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
    removeAllListeners() {
      listeners.message = [];
      listeners.error = [];
    },
    close() {
      return Promise.resolve();
    },
    exists() {
      return Promise.resolve([exists] as [boolean]);
    },
  };
}

function createClientMock(options: {
  subscription: SubscriptionLike;
  topicExists: boolean;
  onCreateSubscription?: () => void;
  onCreateTopic?: () => void;
}): PubSubClientLike {
  const topic: TopicLike = {
    exists() {
      return Promise.resolve([options.topicExists] as [boolean]);
    },
  };

  if (options.onCreateSubscription) {
    topic.createSubscription = () => {
      options.onCreateSubscription?.();
      return Promise.resolve([options.subscription]);
    };
  }

  return {
    subscription() {
      return options.subscription;
    },
    topic() {
      return topic;
    },
    createTopic: options.onCreateTopic
      ? () => {
          options.onCreateTopic?.();
          return Promise.resolve({});
        }
      : undefined,
  };
}

async function deliverMessage(
  listeners: ListenerRegistry,
  message: Message,
): Promise<void> {
  await Promise.all(listeners.message.map((listener) => listener(message)));
}

void test("pubsub subscriber plugin decorates fastify with subscriber methods", async () => {
  const listeners = createListenerRegistry();
  const fakeSubscription = createSubscriptionMock(listeners, true);
  const fakeClient = createClientMock({
    subscription: fakeSubscription,
    topicExists: true,
  });

  const fastify = createFakeFastify();
  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    topicName: "buy-ticket",
  });

  assert.ok(fastify.pubsubSubscriber);
  assert.equal(typeof fastify.pubsubSubscriber.onMessage, "function");
  assert.equal(typeof fastify.pubsubSubscriber.start, "function");
  assert.equal(typeof fastify.pubsubSubscriber.stop, "function");
});

void test("pubsub subscriber processes messages through registered handler", async () => {
  const listeners = createListenerRegistry();
  const fakeSubscription = createSubscriptionMock(listeners, true);
  const fakeClient = createClientMock({
    subscription: fakeSubscription,
    topicExists: true,
  });

  const fastify = createFakeFastify();
  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    topicName: "buy-ticket",
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

void test("pubsub subscriber auto-creates missing subscription when enabled", async () => {
  let createSubscriptionCalls = 0;
  let createTopicCalls = 0;

  const fakeSubscription = createSubscriptionMock(
    createListenerRegistry(),
    false,
  );
  const fakeClient = createClientMock({
    subscription: fakeSubscription,
    topicExists: false,
    onCreateSubscription: () => {
      createSubscriptionCalls += 1;
    },
    onCreateTopic: () => {
      createTopicCalls += 1;
    },
  });

  const fastify = createFakeFastify();
  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    topicName: "buy-ticket",
    autoCreateSubscription: true,
  });

  assert.equal(createTopicCalls, 1);
  assert.equal(createSubscriptionCalls, 1);
});

void test("pubsub subscriber fails on startup when subscription is missing and auto-create is disabled", async () => {
  const fakeSubscription = createSubscriptionMock(
    createListenerRegistry(),
    false,
  );
  const fakeClient = createClientMock({
    subscription: fakeSubscription,
    topicExists: true,
  });

  const fastify = createFakeFastify();

  await assert.rejects(async () => {
    await pubSubSubscriberPlugin(fastify as never, {
      client: fakeClient,
      subscriptionName: "buy-ticket-worker",
      topicName: "buy-ticket",
      autoCreateSubscription: false,
    });
  }, /Configured Pub\/Sub subscription "buy-ticket-worker" does not exist/);
});

void test("pubsub subscriber nacks messages when handler throws", async () => {
  const listeners = createListenerRegistry();
  const fakeSubscription = createSubscriptionMock(listeners, true);
  const fakeClient = createClientMock({
    subscription: fakeSubscription,
    topicExists: true,
  });

  const fastify = createFakeFastify();
  await pubSubSubscriberPlugin(fastify as never, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    topicName: "buy-ticket",
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
