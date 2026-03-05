import fp from "fastify-plugin";
import cors, { FastifyCorsOptions } from "@fastify/cors";

/**
 * This plugin enables the use of CORS in a Fastify application.
 * @see https://github.com/fastify/fastify-cors
 */
export default fp<FastifyCorsOptions>(async (fastify) => {
  await fastify.register(cors, {
    origin: true, // For local development, allow all origins
  });
});
