import fp from "fastify-plugin";
import fastifyRedis, { FastifyRedisPluginOptions } from "@fastify/redis";
import { env } from "@repo/env";

export default fp<FastifyRedisPluginOptions>(async (fastify, _opts) => {
  const redisUrl = env.REDIS_URL;

  fastify.log.info(`Registering Redis plugin with URL: ${redisUrl}`);

  await fastify.register(fastifyRedis, {
    url: redisUrl,
  });
});
