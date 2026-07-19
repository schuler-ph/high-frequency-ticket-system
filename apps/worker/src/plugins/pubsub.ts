import type { Message, PubSub } from "@google-cloud/pubsub";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "@repo/env";

export type MessageHandler = (message: Message) => Promise<void>;

export interface PubSubSubscriber {
  onMessage(handler: MessageHandler): void;
  start(): void;
  stop(): Promise<void>;
}

export interface PubSubSubscriberPluginOptions {
  client?: PubSub;
  subscriptionName?: string;
}

// Subscription-Provisioning lebt in scripts/local/reset-seed.mjs
// (Emulator-REST), nicht mehr im Startup-Pfad des Workers. Der Subscriber ist
// ein reiner Runtime-Client und setzt voraus, dass die Subscription bereits
// existiert und an ihr Topic gebunden ist.
const createPubSubClient = async (): Promise<PubSub> => {
  const { PubSub } = await import("@google-cloud/pubsub");

  return new PubSub({
    projectId: env.GOOGLE_CLOUD_PROJECT,
  });
};

export const pubSubSubscriberPlugin: FastifyPluginAsync<
  PubSubSubscriberPluginOptions
> = async (fastify, opts) => {
  const client = opts.client ?? (await createPubSubClient());
  const subscriptionName =
    opts.subscriptionName ?? env.PUBSUB_SUBSCRIPTION_BUY_TICKET;
  // Explizite Flow-Control statt Library-Default (~1.000 in-flight): begrenzt
  // die gleichzeitigen Handler und damit den DB-Druck.
  const subscription = client.subscription(subscriptionName, {
    flowControl: { maxMessages: env.PUBSUB_FLOW_CONTROL_MAX_MESSAGES },
  });

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
