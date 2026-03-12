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
  exists?: () => Promise<[boolean]>;
};

type PubSubClientLike = {
  topic(topicName: string): TopicLike;
  createTopic?: (topicName: string) => Promise<unknown>;
};

export interface PubSubPluginOptions {
  client?: PubSubClientLike;
  topicName?: string;
  ensureTopicExists?: boolean;
  autoCreateTopic?: boolean;
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

const pubSubPlugin: FastifyPluginCallback<PubSubPluginOptions> = (
  fastify,
  opts,
  done,
) => {
  const client =
    opts.client ?? new PubSub({ projectId: env.GOOGLE_CLOUD_PROJECT });
  const topicName = opts.topicName ?? env.PUBSUB_TOPIC_BUY_TICKET;
  const topic = client.topic(topicName);
  const ensureTopicExists = opts.ensureTopicExists ?? true;
  const autoCreateTopic =
    opts.autoCreateTopic ?? Boolean(env.PUBSUB_EMULATOR_HOST);

  fastify.addHook("onReady", async () => {
    if (!ensureTopicExists) {
      return;
    }

    if (!topic.exists) {
      fastify.log.warn(
        { topic: topicName },
        "Skipping Pub/Sub topic existence check because the client does not support topic.exists",
      );
      return;
    }

    let exists = false;

    try {
      [exists] = await topic.exists();
    } catch (error) {
      if (!isGrpcNotFoundError(error)) {
        throw error;
      }
    }

    if (exists) {
      return;
    }

    if (!autoCreateTopic) {
      throw new Error(
        `Configured Pub/Sub topic \"${topicName}\" does not exist. Create it before starting the API.`,
      );
    }

    if (!client.createTopic) {
      throw new Error(
        `Configured Pub/Sub topic \"${topicName}\" does not exist and client.createTopic is unavailable.`,
      );
    }

    try {
      await client.createTopic(topicName);
      fastify.log.info({ topic: topicName }, "Created missing Pub/Sub topic");
    } catch (error) {
      if (!isGrpcAlreadyExistsError(error)) {
        throw error;
      }
    }
  });

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
