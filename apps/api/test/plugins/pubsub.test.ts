import * as assert from "node:assert";
import { test } from "node:test";
import {
  type PubSubPublisher,
  pubSubPlugin,
} from "../../src/plugins/pubsub.ts";

function createFakeFastify() {
  const hooks: Record<string, Array<() => Promise<void>>> = {};
  const instance = {
    log: {
      info: () => undefined,
      warn: () => undefined,
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
    pubsubPublisher: PubSubPublisher;
  };
}

void test("pubsub plugin decorates fastify with a publish method", async () => {
  let capturedMessage:
    | {
        data: Buffer;
        attributes?: Record<string, string>;
      }
    | undefined;

  const fakeClient = {
    topic(_topicName: string) {
      return {
        publishMessage(message: {
          data: Buffer;
          attributes?: Record<string, string>;
        }) {
          capturedMessage = message;
          return Promise.resolve("message-1");
        },
      };
    },
  };

  const fastify = createFakeFastify();
  await pubSubPlugin(fastify as never, {
    client: fakeClient,
    topicName: "buy-ticket",
  });

  const messageId = await fastify.pubsubPublisher.publishBuyTicket(
    { userId: "user-123", quantity: 1 },
    { requestId: "req-123" },
  );

  assert.equal(messageId, "message-1");
  assert.ok(capturedMessage);
  assert.deepEqual(JSON.parse(capturedMessage.data.toString("utf8")), {
    userId: "user-123",
    quantity: 1,
  });
  assert.deepEqual(capturedMessage.attributes, { requestId: "req-123" });
});

void test("pubsub plugin auto-creates missing topic when enabled", async () => {
  let createTopicCalls = 0;

  const fakeClient = {
    topic(_topicName: string) {
      return {
        exists() {
          return Promise.resolve([false] as [boolean]);
        },
        publishMessage(_message: {
          data: Buffer;
          attributes?: Record<string, string>;
        }) {
          return Promise.resolve("message-2");
        },
      };
    },
    createTopic(_topicName: string) {
      createTopicCalls += 1;
      return Promise.resolve({});
    },
  };

  const fastify = createFakeFastify();
  await pubSubPlugin(fastify as never, {
    client: fakeClient,
    topicName: "buy-ticket",
    autoCreateTopic: true,
  });

  await fastify.runHook("onReady");
  assert.equal(createTopicCalls, 1);
});

void test("pubsub plugin fails on startup when topic is missing and auto-create is disabled", async () => {
  const fakeClient = {
    topic(_topicName: string) {
      return {
        exists() {
          return Promise.resolve([false] as [boolean]);
        },
        publishMessage(_message: {
          data: Buffer;
          attributes?: Record<string, string>;
        }) {
          return Promise.resolve("message-3");
        },
      };
    },
  };

  const fastify = createFakeFastify();
  await pubSubPlugin(fastify as never, {
    client: fakeClient,
    topicName: "buy-ticket",
    autoCreateTopic: false,
  });

  await assert.rejects(async () => {
    await fastify.runHook("onReady");
  }, /Configured Pub\/Sub topic "buy-ticket" does not exist/);
});
