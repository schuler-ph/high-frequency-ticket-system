import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import { Message } from "@google-cloud/pubsub";
import PubSubSubscriberPlugin, {
  type PubSubClientLike,
  type SubscriptionLike,
  type TopicLike,
} from "../../src/plugins/pubsub.js";

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
  message: Array<(message: Message) => void>;
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
  function on(event: "message", listener: (message: Message) => void): void;
  function on(event: "error", listener: (error: Error) => void): void;
  function on(
    event: "message" | "error",
    listener: ((message: Message) => void) | ((error: Error) => void),
  ): void {
    if (event === "message") {
      listeners.message.push(listener as (message: Message) => void);
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

void test("pubsub subscriber plugin decorates fastify with subscriber methods", async () => {
  const listeners = createListenerRegistry();
  const fakeSubscription = createSubscriptionMock(listeners, true);
  const fakeClient = createClientMock({
    subscription: fakeSubscription,
    topicExists: true,
  });

  const fastify = Fastify({ logger: false });
  void fastify.register(PubSubSubscriberPlugin, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    topicName: "buy-ticket",
  });

  await fastify.ready();

  assert.ok(fastify.pubsubSubscriber);
  assert.equal(typeof fastify.pubsubSubscriber.onMessage, "function");
  assert.equal(typeof fastify.pubsubSubscriber.start, "function");
  assert.equal(typeof fastify.pubsubSubscriber.stop, "function");

  await fastify.close();
});

void test("pubsub subscriber processes messages through registered handler", async () => {
  const listeners = createListenerRegistry();
  const fakeSubscription = createSubscriptionMock(listeners, true);
  const fakeClient = createClientMock({
    subscription: fakeSubscription,
    topicExists: true,
  });

  const fastify = Fastify({ logger: false });
  void fastify.register(PubSubSubscriberPlugin, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    topicName: "buy-ticket",
  });

  await fastify.ready();

  const receivedMessages: unknown[] = [];

  fastify.pubsubSubscriber.onMessage(async (message) => {
    receivedMessages.push(JSON.parse(message.data.toString("utf8")));
    message.ack();
  });

  fastify.pubsubSubscriber.start();

  // Simulate receiving a message
  const fakeMessage = createFakeMessage("msg-1", { userId: "user-123" });
  for (const listener of listeners.message) {
    listener(fakeMessage as unknown as Message);
  }

  // Give async handler time to process
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(receivedMessages.length, 1);
  assert.deepEqual(receivedMessages[0], { userId: "user-123" });
  assert.ok(fakeMessage.acked);
  assert.ok(!fakeMessage.nacked);

  await fastify.close();
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

  const fastify = Fastify({ logger: false });
  void fastify.register(PubSubSubscriberPlugin, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    topicName: "buy-ticket",
    autoCreateSubscription: true,
  });

  await fastify.ready();

  assert.equal(createTopicCalls, 1);
  assert.equal(createSubscriptionCalls, 1);

  await fastify.close();
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

  const fastify = Fastify({ logger: false });
  void fastify.register(PubSubSubscriberPlugin, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    topicName: "buy-ticket",
    autoCreateSubscription: false,
  });

  await assert.rejects(async () => {
    await fastify.ready();
  }, /Configured Pub\/Sub subscription "buy-ticket-worker" does not exist/);
});

void test("pubsub subscriber nacks messages when handler throws", async () => {
  const listeners = createListenerRegistry();
  const fakeSubscription = createSubscriptionMock(listeners, true);
  const fakeClient = createClientMock({
    subscription: fakeSubscription,
    topicExists: true,
  });

  const fastify = Fastify({ logger: false });
  void fastify.register(PubSubSubscriberPlugin, {
    client: fakeClient,
    subscriptionName: "buy-ticket-worker",
    topicName: "buy-ticket",
  });

  await fastify.ready();

  fastify.pubsubSubscriber.onMessage(async () => {
    throw new Error("Processing failed");
  });

  fastify.pubsubSubscriber.start();

  // Simulate receiving a message
  const fakeMessage = createFakeMessage("msg-1", { userId: "user-123" });
  for (const listener of listeners.message) {
    listener(fakeMessage as unknown as Message);
  }

  // Give async handler time to process
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(!fakeMessage.acked);
  assert.ok(fakeMessage.nacked);

  await fastify.close();
});
