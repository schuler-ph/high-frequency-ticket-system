import { setTimeout } from "node:timers/promises";
import type { FastifyPluginAsync } from "fastify";
import { buyTicketRequestSchema } from "@repo/types/tickets";

const pubSubListenerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.pubsubSubscriber.onMessage(async (message) => {
    const rawPayload = message.data?.toString("utf8") ?? "";

    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload);
    } catch (error) {
      fastify.log.warn(
        { messageId: message.id, error },
        "Invalid BuyTicketEvent payload JSON",
      );
      message.nack();
      return;
    }

    const parsed = buyTicketRequestSchema.safeParse(payload);
    if (!parsed.success) {
      fastify.log.warn(
        { messageId: message.id, issues: parsed.error.issues },
        "BuyTicketEvent payload failed validation",
      );
      message.nack();
      return;
    }

    fastify.log.info(
      { messageId: message.id, eventId: parsed.data.eventId },
      "Received BuyTicketEvent",
    );

    await setTimeout(1000);

    message.ack();
  });

  fastify.addHook("onReady", async () => {
    fastify.pubsubSubscriber.start();
  });
};

export default pubSubListenerRoutes;
