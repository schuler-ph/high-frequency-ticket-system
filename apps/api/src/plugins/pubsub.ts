import { PubSub } from "@google-cloud/pubsub";
import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { env } from "@repo/env";

export type PubSubAttributes = Record<string, string>;

export interface PubSubPublisher {
  publishBuyTicket(
    payload: unknown,
    attributes?: PubSubAttributes,
  ): Promise<string>;
}

type TopicLike = {
  publishMessage(message: {
    data: Buffer;
    attributes?: PubSubAttributes;
  }): Promise<string>;
};

type PubSubClientLike = {
  topic(topicName: string): TopicLike;
};

export interface PubSubPluginOptions {
  client?: PubSubClientLike;
  topicName?: string;
}

const pubSubPlugin: FastifyPluginCallback<PubSubPluginOptions> = (
  fastify,
  opts,
  done,
) => {
  const client =
    opts.client ?? new PubSub({ projectId: env.GOOGLE_CLOUD_PROJECT });
  const topicName = opts.topicName ?? env.PUBSUB_TOPIC_BUY_TICKET;
  const topic = client.topic(topicName);

  const publisher: PubSubPublisher = {
    publishBuyTicket(payload, attributes) {
      const data = Buffer.from(JSON.stringify(payload));
      return topic.publishMessage({ data, attributes });
    },
  };

  fastify.decorate("pubsubPublisher", publisher);

  fastify.log.info(
    {
      projectId: env.GOOGLE_CLOUD_PROJECT,
      topic: topicName,
      emulatorHost: env.PUBSUB_EMULATOR_HOST,
    },
    "Registered Pub/Sub publisher plugin",
  );

  done();
};

export default fp(pubSubPlugin);

declare module "fastify" {
  export interface FastifyInstance {
    pubsubPublisher: PubSubPublisher;
  }
}
