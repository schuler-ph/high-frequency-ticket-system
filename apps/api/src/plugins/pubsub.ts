import type { PubSub } from "@google-cloud/pubsub";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "@repo/env";
import { fatalPubSubCode } from "../lib/pubsub-errors.ts";
// Zieht die `serviceHealth`-Deklaration aus dem Plugin in diesen Typgraphen.
// Das Gegenstueck zur Laufzeit-Abhaengigkeit `dependencies: ["service-health"]`.
import type {} from "./service-health.ts";

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
  /**
   * Reaktion auf einen dauerhaften Publish-Fehler. Default: sauber
   * herunterfahren und mit Exit-Code 1 beenden (ADR-044). Tests reichen hier
   * eine Attrappe herein, damit sie nicht den Testrunner beenden.
   */
  onFatal?: () => void;
}

// Topic-Provisioning lebt in scripts/local/reset-seed.mjs (Emulator-REST),
// nicht mehr im Startup-Pfad der API. Der Publisher ist ein reiner
// Runtime-Client und setzt voraus, dass das Topic bereits existiert. Fehlt es,
// faellt das beim ersten Publish auf und macht den Prozess arbeitsunfaehig
// (ADR-044) — nicht beim Boot, siehe dort "Alternativen".
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

  /**
   * Ohne Topic ist der Kauf-Funnel tot: `/buy` reserviert weiter, aber jede
   * Zahlung scheitert — die API haelt dann Inventar fest, das niemand
   * einloesen kann. Ein Prozess, der nur 503 meldet, wird von niemandem neu
   * gestartet: Docker reagiert auf das Prozess-Ende, nicht auf einen
   * Healthcheck. Also beendet er sich selbst; Neustart und Backoff uebernehmen
   * `restart: unless-stopped` bzw. der kubelet (ADR-044).
   */
  const shutdownAsUnrecoverable = (): void => {
    void fastify
      .close()
      .catch((err: unknown) =>
        fastify.log.error({ err }, "Shutdown after fatal error failed"),
      )
      .finally(() => process.exit(1));
  };

  const onFatal = opts.onFatal ?? shutdownAsUnrecoverable;

  fastify.decorate("pubsubPublisher", {
    async publishBuyTicket(payload: unknown, attributes?: PubSubAttributes) {
      try {
        return await topic.publishMessage({
          data: Buffer.from(JSON.stringify(payload)),
          attributes,
        });
      } catch (err) {
        // Nach der Startup-Pruefung kann das Topic nur noch verschwinden, wenn
        // es jemand loescht oder die Rechte entzieht. Beides trifft alle
        // Requests gleichermassen, also den Prozess als arbeitsunfaehig
        // markieren statt jede Zahlung einzeln mit 500 abzuweisen.
        const fatalCode = fatalPubSubCode(err);
        if (fatalCode !== null) {
          fastify.serviceHealth.markFatal(
            `Pub/Sub topic "${topicName}" is permanently unavailable (${fatalCode}). ` +
              "Provision it and restart the API.",
          );
          onFatal();
        }
        throw err;
      }
    },
  });

  fastify.log.info(
    {
      projectId: env.GOOGLE_CLOUD_PROJECT,
      topic: topicName,
      pubsubTarget: env.PUBSUB_EMULATOR_HOST ? "emulator" : "google-cloud",
      emulatorHost: env.PUBSUB_EMULATOR_HOST,
    },
    "Registered Pub/Sub publisher plugin",
  );
};

export default fp(pubSubPlugin, {
  name: "pubsub",
  dependencies: ["service-health"],
});

declare module "fastify" {
  export interface FastifyInstance {
    pubsubPublisher: PubSubPublisher;
  }
}
