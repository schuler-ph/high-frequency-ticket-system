import type { PubSub } from "@google-cloud/pubsub";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "@repo/env";

export type PubSubAttributes = Record<string, string>;

export interface PubSubPublisher {
  publishBuyTicket(
    payload: unknown,
    attributes?: PubSubAttributes,
  ): Promise<string>;
}

export interface PubSubPluginOptions {
  client?: PubSub;
  topicName?: string;
}

// Topic-Provisioning lebt in scripts/local/reset-seed.mjs (Emulator-REST),
// nicht mehr im Startup-Pfad der API. Der Publisher ist ein reiner
// Runtime-Client und setzt voraus, dass das Topic bereits existiert.
const createPubSubClient = async (): Promise<PubSub> => {
  const { PubSub } = await import("@google-cloud/pubsub");

  return new PubSub({
    projectId: env.GOOGLE_CLOUD_PROJECT,
  });
};

export const pubSubPlugin: FastifyPluginAsync<PubSubPluginOptions> = async (
  fastify,
  opts,
) => {
  const client = opts.client ?? (await createPubSubClient());
  const topicName = opts.topicName ?? env.PUBSUB_TOPIC_BUY_TICKET;
  const topic = client.topic(topicName);

  fastify.decorate("pubsubPublisher", {
    publishBuyTicket(payload: unknown, attributes?: PubSubAttributes) {
      return topic.publishMessage({
        data: Buffer.from(JSON.stringify(payload)),
        attributes,
      });
    },
  });

  fastify.log.info(
    {
      projectId: env.GOOGLE_CLOUD_PROJECT,
      topic: topicName,
      emulatorHost: env.PUBSUB_EMULATOR_HOST,
    },
    "Registered Pub/Sub publisher plugin",
  );
};

export default fp(pubSubPlugin);

declare module "fastify" {
  export interface FastifyInstance {
    pubsubPublisher: PubSubPublisher;
  }
}
