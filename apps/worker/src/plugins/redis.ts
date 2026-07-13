import fp from "fastify-plugin";
import fastifyRedis, { FastifyRedisPluginOptions } from "@fastify/redis";
import { env } from "@repo/env";
import { withStartupTimeout } from "../lib/startup-timeout.ts";

export default fp<FastifyRedisPluginOptions>(async (fastify, _opts) => {
  const redisUrl = env.REDIS_URL;

  fastify.log.info({ redisUrl }, "Connecting to Redis");

  // @fastify/redis awaits the ioredis `ready` event during registration, and
  // ioredis retries a refused connection forever by default — so an unreachable
  // Redis would hang here until Fastify's generic plugin timeout with no hint
  // about the cause. Bound the wait and surface an actionable message instead.
  try {
    await withStartupTimeout(
      fastify.register(fastifyRedis, {
        url: redisUrl,
        connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
      }),
      env.REDIS_CONNECT_TIMEOUT_MS,
      `Redis did not become ready within ${env.REDIS_CONNECT_TIMEOUT_MS}ms at ${redisUrl}. Is the hts-redis container running? Start it with \`docker compose up -d\`.`,
    );
  } catch (err) {
    fastify.log.fatal({ err, redisUrl }, "Redis startup check failed");
    throw err;
  }

  // Keep runtime reconnection behaviour (ioredis default) but make it visible.
  fastify.redis.on("error", (err) =>
    fastify.log.error({ err }, "Redis client error"),
  );
  fastify.redis.on("reconnecting", () =>
    fastify.log.warn("Redis connection lost, reconnecting"),
  );

  await fastify.redis.ping();
  fastify.log.info("Redis connection ready (PING ok)");
});
