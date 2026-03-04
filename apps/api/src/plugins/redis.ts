import fp from "fastify-plugin";
import fastifyRedis, { FastifyRedisPluginOptions } from "@fastify/redis";

export default fp<FastifyRedisPluginOptions>(async (fastify, _opts) => {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  fastify.log.info(`Registering Redis plugin with URL: ${redisUrl}`);

  await fastify.register(fastifyRedis, {
    url: redisUrl,
  });
});
