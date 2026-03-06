import * as assert from "node:assert";
import { test } from "node:test";
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
