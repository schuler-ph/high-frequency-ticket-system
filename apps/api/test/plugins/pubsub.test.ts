import * as assert from "node:assert";
import { test } from "vitest";
import Fastify from "fastify";
import PubSubPlugin from "../../src/plugins/pubsub.js";

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

  const fastify = Fastify({ logger: false });
  void fastify.register(PubSubPlugin, {
    client: fakeClient,
    topicName: "buy-ticket",
  });

  await fastify.ready();

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

  await fastify.close();
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

  const fastify = Fastify({ logger: false });
  void fastify.register(PubSubPlugin, {
    client: fakeClient,
    topicName: "buy-ticket",
    autoCreateTopic: true,
  });

  await fastify.ready();
  assert.equal(createTopicCalls, 1);
  await fastify.close();
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

  const fastify = Fastify({ logger: false });
  void fastify.register(PubSubPlugin, {
    client: fakeClient,
    topicName: "buy-ticket",
    autoCreateTopic: false,
  });

  try {
    await assert.rejects(async () => {
      await fastify.ready();
    }, /Configured Pub\/Sub topic "buy-ticket" does not exist/);
  } finally {
    await fastify.close().catch(() => undefined);
  }
});
