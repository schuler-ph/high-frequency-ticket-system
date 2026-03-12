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

const isGrpcCode = (err: unknown, code: number): boolean =>
  err instanceof Error && "code" in err && err.code === code;

const pubSubPlugin: FastifyPluginCallback<PubSubPluginOptions> = (
  fastify,
  opts,
  done,
) => {
  const client =
    opts.client ?? new PubSub({ projectId: env.GOOGLE_CLOUD_PROJECT });
  const topicName = opts.topicName ?? env.PUBSUB_TOPIC_BUY_TICKET;
  const topic = client.topic(topicName);
  const autoCreate = opts.autoCreateTopic ?? Boolean(env.PUBSUB_EMULATOR_HOST);

  if (opts.ensureTopicExists !== false) {
    fastify.addHook("onReady", async () => {
      if (!topic.exists) {
        fastify.log.warn(
          { topic: topicName },
          "Skipping Pub/Sub topic existence check — client does not support topic.exists",
        );
        return;
      }

      let exists = false;
      try {
        [exists] = await topic.exists();
      } catch (err) {
        if (!isGrpcCode(err, 5)) throw err;
      }

      if (exists) return;

      if (!autoCreate || !client.createTopic) {
        throw new Error(
          `Configured Pub/Sub topic "${topicName}" does not exist. Create it before starting the API.`,
        );
      }

      try {
        await client.createTopic(topicName);
        fastify.log.info({ topic: topicName }, "Created missing Pub/Sub topic");
      } catch (err) {
        if (!isGrpcCode(err, 6)) throw err;
      }
    });
  }

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

  done();
};

export default fp(pubSubPlugin);

declare module "fastify" {
  export interface FastifyInstance {
    pubsubPublisher: PubSubPublisher;
  }
}
