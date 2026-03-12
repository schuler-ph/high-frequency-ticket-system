import { Message, PubSub } from "@google-cloud/pubsub";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "@repo/env";

export type MessageHandler = (message: Message) => Promise<void>;

export interface PubSubSubscriber {
  /**
   * Register a handler for incoming messages.
   * The handler is responsible for calling message.ack() or message.nack().
   */
  onMessage(handler: MessageHandler): void;

  /**
   * Start listening for messages.
   * Call this after registering your handler.
   */
  start(): void;

  /**
   * Stop listening for messages.
   * Called automatically on server close.
   */
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

export type PubSubClientLike = {
  subscription(subscriptionName: string): SubscriptionLike;
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

function isGrpcNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return "code" in error && typeof error.code === "number" && error.code === 5;
}

function isGrpcAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return "code" in error && typeof error.code === "number" && error.code === 6;
}

const pubSubSubscriberPlugin: FastifyPluginAsync<
  PubSubSubscriberPluginOptions
> = async (fastify, opts) => {
  const client =
    opts.client ?? new PubSub({ projectId: env.GOOGLE_CLOUD_PROJECT });
  const subscriptionName =
    opts.subscriptionName ?? env.PUBSUB_SUBSCRIPTION_BUY_TICKET;
  const topicName = opts.topicName ?? env.PUBSUB_TOPIC_BUY_TICKET;
  const subscription = client.subscription(subscriptionName);
  const ensureSubscriptionExists = opts.ensureSubscriptionExists ?? true;
  const autoCreateSubscription =
    opts.autoCreateSubscription ?? Boolean(env.PUBSUB_EMULATOR_HOST);

  let messageHandler: MessageHandler | null = null;
  let isListening = false;

  // Ensure subscription exists (and create if needed in emulator mode)
  if (ensureSubscriptionExists) {
    if (!subscription.exists) {
      fastify.log.warn(
        { subscription: subscriptionName },
        "Skipping Pub/Sub subscription existence check because the client does not support subscription.exists",
      );
    } else {
      let exists = false;

      try {
        [exists] = await subscription.exists();
      } catch (error) {
        if (!isGrpcNotFoundError(error)) {
          throw error;
        }
      }

      if (!exists) {
        if (!autoCreateSubscription) {
          throw new Error(
            `Configured Pub/Sub subscription "${subscriptionName}" does not exist. Create it before starting the worker.`,
          );
        }

        // In emulator mode, we also need to ensure the topic exists first
        const topic = client.topic(topicName);

        if (topic.exists) {
          let topicExists = false;

          try {
            [topicExists] = await topic.exists();
          } catch (error) {
            if (!isGrpcNotFoundError(error)) {
              throw error;
            }
          }

          if (!topicExists && client.createTopic) {
            try {
              await client.createTopic(topicName);
              fastify.log.info(
                { topic: topicName },
                "Created missing Pub/Sub topic",
              );
            } catch (error) {
              if (!isGrpcAlreadyExistsError(error)) {
                throw error;
              }
            }
          }
        }

        // Create subscription attached to topic
        if (topic.createSubscription) {
          try {
            await topic.createSubscription(subscriptionName);
            fastify.log.info(
              { subscription: subscriptionName, topic: topicName },
              "Created missing Pub/Sub subscription",
            );
          } catch (error) {
            if (!isGrpcAlreadyExistsError(error)) {
              throw error;
            }
          }
        } else {
          throw new Error(
            `Configured Pub/Sub subscription "${subscriptionName}" does not exist and topic.createSubscription is unavailable.`,
          );
        }
      }
    }
  }

  const handleMessage = async (message: Message): Promise<void> => {
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
    } catch (error) {
      fastify.log.error(
        { messageId: message.id, error },
        "Error processing message",
      );
      message.nack();
    }
  };

  const subscriber: PubSubSubscriber = {
    onMessage(handler: MessageHandler): void {
      messageHandler = handler;
    },

    start(): void {
      if (isListening) {
        return;
      }

      subscription.on("message", handleMessage);
      subscription.on("error", (error) => {
        fastify.log.error({ error }, "Pub/Sub subscription error");
      });

      isListening = true;
      fastify.log.info(
        { subscription: subscriptionName },
        "Started listening for Pub/Sub messages",
      );
    },

    async stop(): Promise<void> {
      if (!isListening) {
        return;
      }

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

  // Clean up on server close
  fastify.addHook("onClose", async () => {
    await subscriber.stop();
  });

  fastify.log.info(
    {
      projectId: env.GOOGLE_CLOUD_PROJECT,
      subscription: subscriptionName,
      topic: topicName,
      emulatorHost: env.PUBSUB_EMULATOR_HOST,
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
