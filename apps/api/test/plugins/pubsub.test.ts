import * as assert from "node:assert";
import { test } from "node:test";
import type { PubSub } from "@google-cloud/pubsub";
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
        exists() {
          return Promise.resolve([true]);
        },
        publishMessage(message: {
          data: Buffer;
          attributes?: Record<string, string>;
        }) {
          capturedMessage = message;
          return Promise.resolve("message-1");
        },
      };
    },
  } as unknown as PubSub;

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

/** Topic-Mock mit steuerbarer Existenz und steuerbarem Publish-Fehler. */
function createTopicClient(options: {
  exists?: boolean;
  publishError?: unknown;
}): PubSub {
  return {
    topic() {
      return {
        exists() {
          return Promise.resolve([options.exists ?? true]);
        },
        publishMessage() {
          if (options.publishError) return Promise.reject(options.publishError);
          return Promise.resolve("message-1");
        },
      };
    },
  } as unknown as PubSub;
}

void test("a permanent publish failure marks the api unhealthy", async () => {
  const fastify = createFakeFastify();
  await pubSubPlugin(fastify as never, {
    client: createTopicClient({
      publishError: Object.assign(new Error("Topic not found"), { code: 5 }),
    }),
    topicName: "buy-ticket",
  });

  await assert.rejects(() =>
    fastify.pubsubPublisher.publishBuyTicket({ orderId: "order-1" }),
  );

  assert.match(
    fastify.serviceHealth.fatalReason ?? "",
    /permanently unavailable \(NOT_FOUND\)/,
  );
});

void test("a transient publish failure leaves the api healthy", async () => {
  const fastify = createFakeFastify();
  await pubSubPlugin(fastify as never, {
    client: createTopicClient({
      publishError: Object.assign(new Error("UNAVAILABLE"), { code: 14 }),
    }),
    topicName: "buy-ticket",
  });

  await assert.rejects(() =>
    fastify.pubsubPublisher.publishBuyTicket({ orderId: "order-1" }),
  );

  assert.equal(fastify.serviceHealth.fatalReason, null);
});
