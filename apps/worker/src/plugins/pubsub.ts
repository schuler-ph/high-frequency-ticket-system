import type { Message } from "@google-cloud/pubsub";
import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "@repo/env";
import { withStartupTimeout } from "../lib/startup-timeout.ts";

const unreachableHint = (operation: string, timeoutMs: number): string =>
  `Pub/Sub ${operation} timed out after ${timeoutMs}ms. Is the emulator reachable at PUBSUB_EMULATOR_HOST=${env.PUBSUB_EMULATOR_HOST}? Start it with \`docker compose up -d\`.`;

export type MessageHandler = (message: Message) => Promise<void>;

export interface PubSubSubscriber {
  onMessage(handler: MessageHandler): void;
  start(): void;
  stop(): Promise<void>;
}

export type SubscriptionLike = {
  on(event: "message", listener: (message: Message) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  removeAllListeners(event?: string): void;
  close(): Promise<void>;
  exists?: () => Promise<[boolean]>;
};

export type TopicLike = {
  createSubscription?: (
    subscriptionName: string,
  ) => Promise<[SubscriptionLike]>;
  exists?: () => Promise<[boolean]>;
};

export type SubscriptionOptionsLike = {
  flowControl?: { maxMessages?: number };
};

export type PubSubClientLike = {
  subscription(
    subscriptionName: string,
    options?: SubscriptionOptionsLike,
  ): SubscriptionLike;
  topic(topicName: string): TopicLike;
  createTopic?: (topicName: string) => Promise<unknown>;
};

export interface PubSubSubscriberPluginOptions {
  client?: PubSubClientLike;
  subscriptionName?: string;
  topicName?: string;
  ensureSubscriptionExists?: boolean;
  autoCreateSubscription?: boolean;
}

const createPubSubClient = async (): Promise<PubSubClientLike> => {
  const { PubSub } = await import("@google-cloud/pubsub");

  return new PubSub({
    projectId: env.GOOGLE_CLOUD_PROJECT,
  }) as unknown as PubSubClientLike;
};

const isGrpcCode = (err: unknown, code: number): boolean =>
  err instanceof Error && "code" in err && err.code === code;

export async function ensureSubscription(
  subscription: SubscriptionLike,
  client: PubSubClientLike,
  subscriptionName: string,
  topicName: string,
  autoCreate: boolean,
  log: FastifyBaseLogger,
  timeoutMs: number,
): Promise<void> {
  if (!subscription.exists) {
    log.warn(
      { subscription: subscriptionName },
      "Skipping Pub/Sub subscription existence check — client does not support exists()",
    );
    return;
  }

  log.info(
    { subscription: subscriptionName, topic: topicName },
    "Verifying Pub/Sub subscription connectivity",
  );

  let exists = false;
  try {
    [exists] = await withStartupTimeout(
      subscription.exists(),
      timeoutMs,
      unreachableHint("subscription existence check", timeoutMs),
    );
  } catch (err) {
    if (!isGrpcCode(err, 5)) throw err;
  }

  if (exists) return;

  if (!autoCreate) {
    throw new Error(
      `Configured Pub/Sub subscription "${subscriptionName}" does not exist. Create it before starting the worker.`,
    );
  }

  const topic = client.topic(topicName);

  if (topic.exists) {
    let topicExists = false;
    try {
      [topicExists] = await withStartupTimeout(
        topic.exists(),
        timeoutMs,
        unreachableHint("topic existence check", timeoutMs),
      );
    } catch (err) {
      if (!isGrpcCode(err, 5)) throw err;
    }

    if (!topicExists && client.createTopic) {
      try {
        await withStartupTimeout(
          client.createTopic(topicName),
          timeoutMs,
          unreachableHint("topic creation", timeoutMs),
        );
        log.info({ topic: topicName }, "Created missing Pub/Sub topic");
      } catch (err) {
        if (!isGrpcCode(err, 6)) throw err;
      }
    }
  }

  if (!topic.createSubscription) {
    throw new Error(
      `Configured Pub/Sub subscription "${subscriptionName}" does not exist and topic.createSubscription is unavailable.`,
    );
  }

  try {
    await withStartupTimeout(
      topic.createSubscription(subscriptionName),
      timeoutMs,
      unreachableHint("subscription creation", timeoutMs),
    );
    log.info(
      { subscription: subscriptionName, topic: topicName },
      "Created missing Pub/Sub subscription",
    );
  } catch (err) {
    if (!isGrpcCode(err, 6)) throw err;
  }
}

export const pubSubSubscriberPlugin: FastifyPluginAsync<
  PubSubSubscriberPluginOptions
> = async (fastify, opts) => {
  const client = opts.client ?? (await createPubSubClient());
  const subscriptionName =
    opts.subscriptionName ?? env.PUBSUB_SUBSCRIPTION_BUY_TICKET;
  const topicName = opts.topicName ?? env.PUBSUB_TOPIC_BUY_TICKET;
  // Explizite Flow-Control statt Library-Default (~1.000 in-flight): begrenzt
  // die gleichzeitigen Handler (Payment-Mock 1 s) und damit den DB-Druck.
  const subscription = client.subscription(subscriptionName, {
    flowControl: { maxMessages: env.PUBSUB_FLOW_CONTROL_MAX_MESSAGES },
  });
  const autoCreate =
    opts.autoCreateSubscription ?? Boolean(env.PUBSUB_EMULATOR_HOST);

  if (opts.ensureSubscriptionExists !== false) {
    try {
      await ensureSubscription(
        subscription,
        client,
        subscriptionName,
        topicName,
        autoCreate,
        fastify.log,
        env.PUBSUB_STARTUP_TIMEOUT_MS,
      );
    } catch (err) {
      fastify.log.error(
        { err, subscription: subscriptionName, topic: topicName },
        "Pub/Sub subscriber startup check failed",
      );
      throw err;
    }
  }

  let messageHandler: MessageHandler | null = null;
  let isListening = false;

  const subscriber: PubSubSubscriber = {
    onMessage(handler) {
      messageHandler = handler;
    },

    start() {
      if (isListening) return;

      subscription.on("message", async (message) => {
        if (!messageHandler) {
          fastify.log.warn(
            { messageId: message.id },
            "Received message but no handler registered, nacking",
          );
          message.nack();
          return;
        }
        try {
          await messageHandler(message);
        } catch (err) {
          fastify.log.error(
            { messageId: message.id, error: err },
            "Error processing message",
          );
          message.nack();
        }
      });
      subscription.on("error", (err) =>
        fastify.log.error({ error: err }, "Pub/Sub subscription error"),
      );

      isListening = true;
      fastify.log.info(
        { subscription: subscriptionName },
        "Started listening for Pub/Sub messages",
      );
    },

    async stop() {
      if (!isListening) return;
      subscription.removeAllListeners();
      await subscription.close();
      isListening = false;
      fastify.log.info(
        { subscription: subscriptionName },
        "Stopped listening for Pub/Sub messages",
      );
    },
  };

  fastify.decorate("pubsubSubscriber", subscriber);
  fastify.addHook("onClose", () => subscriber.stop());

  fastify.log.info(
    {
      projectId: env.GOOGLE_CLOUD_PROJECT,
      subscription: subscriptionName,
      topic: topicName,
      emulatorHost: env.PUBSUB_EMULATOR_HOST,
      flowControlMaxMessages: env.PUBSUB_FLOW_CONTROL_MAX_MESSAGES,
    },
    "Registered Pub/Sub subscriber plugin",
  );
};

export default fp(pubSubSubscriberPlugin);

declare module "fastify" {
  export interface FastifyInstance {
    pubsubSubscriber: PubSubSubscriber;
  }
}
