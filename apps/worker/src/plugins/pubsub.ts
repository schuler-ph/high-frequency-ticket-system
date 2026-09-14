import type { Message, PubSub } from "@google-cloud/pubsub";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "@repo/env";
import { fatalPubSubCode } from "../lib/pubsub-errors.ts";
// Zieht die `serviceHealth`-Deklaration aus dem Plugin in diesen Typgraphen.
// Das Gegenstueck zur Laufzeit-Abhaengigkeit `dependencies: ["service-health"]`.
import type {} from "./service-health.ts";

export type MessageHandler = (message: Message) => Promise<void>;

export interface PubSubSubscriber {
  onMessage(handler: MessageHandler): void;
  start(): void;
  stop(): Promise<void>;
}

export interface PubSubSubscriberPluginOptions {
  client?: PubSub;
  subscriptionName?: string;
  /**
   * Reaktion auf einen dauerhaften Subscriber-Fehler. Default: sauber
   * herunterfahren und mit Exit-Code 1 beenden (ADR-044). Tests reichen hier
   * eine Attrappe herein, damit sie nicht den Testrunner beenden.
   */
  onFatal?: () => void;
}

// Subscription-Provisioning lebt in scripts/local/reset-seed.mjs
// (Emulator-REST), nicht mehr im Startup-Pfad des Workers. Der Subscriber ist
// ein reiner Runtime-Client und setzt voraus, dass die Subscription bereits
// existiert und an ihr Topic gebunden ist. Fehlt sie, meldet der Subscriber
// binnen Sekunden NOT_FOUND und der Prozess wird arbeitsunfaehig (ADR-044).
const createPubSubClient = async (): Promise<PubSub> => {
  const { PubSub } = await import("@google-cloud/pubsub");

  return new PubSub({
    projectId: env.GOOGLE_CLOUD_PROJECT,
  });
};

export const pubSubSubscriberPlugin: FastifyPluginAsync<
  PubSubSubscriberPluginOptions
> = async (fastify, opts) => {
  const { Duration } = await import("@google-cloud/pubsub");

  const client = opts.client ?? (await createPubSubClient());
  const subscriptionName =
    opts.subscriptionName ?? env.PUBSUB_SUBSCRIPTION_BUY_TICKET;
  // Explizite Flow-Control statt Library-Default (~1.000 in-flight): begrenzt
  // die gleichzeitigen Handler und damit den DB-Druck.
  //
  // `closeOptions` kehrt den Library-Default um: statt zugestellte Nachrichten
  // beim Schliessen sofort zu nacken ("NACK"), laesst "WAIT" die laufenden
  // Handler zu Ende kommen und nackt erst danach, was uebrig ist. Genau das
  // unterscheidet ein Rolling Update ohne Redelivery-Ausschlag von einem mit.
  const subscription = client.subscription(subscriptionName, {
    flowControl: { maxMessages: env.PUBSUB_FLOW_CONTROL_MAX_MESSAGES },
    closeOptions: {
      behavior: "WAIT",
      timeout: Duration.from({
        seconds: env.WORKER_SHUTDOWN_DRAIN_TIMEOUT_SECONDS,
      }),
    },
  });

  /**
   * Ohne Subscription kann der Worker nichts — und ein Prozess, der nur einen
   * 503 meldet, wird von niemandem neu gestartet: Docker reagiert auf das
   * Prozess-Ende, nicht auf einen Healthcheck, und eine Liveness-Probe gibt es
   * nur in Kubernetes. Also beendet er sich selbst; Neustart und Backoff
   * uebernehmen `restart: unless-stopped` bzw. der kubelet (ADR-044).
   *
   * `close()` zuerst, damit der Shutdown derselbe geordnete Weg ist wie bei
   * SIGTERM (Subscriber stoppen, Verbindungen schliessen).
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

  let messageHandler: MessageHandler | null = null;
  let isListening = false;

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
    } catch (err) {
      fastify.log.error(
        { messageId: message.id, error: err },
        "Error processing message",
      );
      message.nack();
    }
  };

  // Der Client stellt einen Streaming-Pull nach transienten Fehlern selbst
  // wieder her, aber nicht nach dauerhaften: bei NOT_FOUND stirbt der Stream
  // endgueltig, der Prozess laeuft weiter und verarbeitet nie wieder etwas.
  // Ohne diese Unterscheidung bleibt genau das unsichtbar (ADR-044).
  const handleSubscriptionError = (err: Error): void => {
    const fatalCode = fatalPubSubCode(err);

    if (fatalCode === null) {
      fastify.log.error(
        { error: err },
        "Pub/Sub subscription error (transient, client will retry)",
      );
      return;
    }

    fastify.log.fatal(
      { error: err, subscription: subscriptionName, code: fatalCode },
      "Pub/Sub subscription is permanently unavailable",
    );
    fastify.serviceHealth.markFatal(
      `Pub/Sub subscription "${subscriptionName}" is permanently unavailable (${fatalCode}). ` +
        "Provision it and restart the worker.",
    );
    onFatal();
  };

  const subscriber: PubSubSubscriber = {
    onMessage(handler) {
      messageHandler = handler;
    },

    start() {
      if (isListening) return;

      subscription.on("message", handleMessage);
      subscription.on("error", handleSubscriptionError);

      isListening = true;
      fastify.log.info(
        { subscription: subscriptionName },
        "Started listening for Pub/Sub messages",
      );
    },

    async stop() {
      if (!isListening) return;
      isListening = false;

      // Nur den Fehler-Listener abmelden, und zwar vor `close()`: das Schliessen
      // zerstoert den Streaming-Pull, und der dabei gemeldete Fehler wuerde
      // sonst als dauerhafter Ausfall gewertet — `onFatal` beendete den Prozess
      // mitten im Drain per `process.exit(1)`. Der `message`-Listener bleibt
      // haengen, bis `close()` zurueckkehrt: er quittiert die Nachrichten, auf
      // deren Abschluss der Drain gerade wartet.
      subscription.removeListener("error", handleSubscriptionError);

      fastify.log.info(
        {
          subscription: subscriptionName,
          drainTimeoutSeconds: env.WORKER_SHUTDOWN_DRAIN_TIMEOUT_SECONDS,
        },
        "Draining in-flight Pub/Sub messages before shutdown",
      );
      await subscription.close();
      subscription.removeAllListeners();

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
      pubsubTarget: env.PUBSUB_EMULATOR_HOST ? "emulator" : "google-cloud",
      emulatorHost: env.PUBSUB_EMULATOR_HOST,
      flowControlMaxMessages: env.PUBSUB_FLOW_CONTROL_MAX_MESSAGES,
    },
    "Registered Pub/Sub subscriber plugin",
  );
};

export default fp(pubSubSubscriberPlugin, {
  name: "pubsub",
  dependencies: ["service-health"],
});

declare module "fastify" {
  export interface FastifyInstance {
    pubsubSubscriber: PubSubSubscriber;
  }
}
