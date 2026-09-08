import fp from "fastify-plugin";

/**
 * This plugin enables the a graceful shutdown of the Fastify application.
 */
export default fp(async (fastify) => {
  fastify.addHook("onClose", async (instance) => {
    instance.log.info("Fastify instance is closing. Performing cleanup...");
  });
});
