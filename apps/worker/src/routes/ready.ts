import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { readySchema } from "@repo/types/health";
// Zieht die `redis`-Deklaration von @fastify/redis in diesen Typgraphen.
// Das Gegenstueck zur Laufzeit-Registrierung in `plugins/redis.ts`.
import type {} from "@fastify/redis";

/** ioredis meldet erst in diesem Status, dass Kommandos sofort rausgehen. */
const REDIS_READY_STATUS = "ready";

/**
 * Readiness-Endpunkt des Workers. Er bedient keinen Nutzer-Traffic, die Probe
 * hat hier trotzdem einen Job: Beim Rolling Update gilt ein neuer Pod erst als
 * verfuegbar, wenn er ready meldet — ohne sie taeuscht ein noch nicht
 * verbundener Pod Fortschritt vor und der alte wird zu frueh abgeraeumt.
 *
 * Dass ein ausgefallener Worker auffaellt, ist dagegen nicht Aufgabe dieser
 * Probe, sondern eines Alerts (REQ-O04): Readiness steuert Traffic, sie meldet
 * niemandem etwas.
 *
 * Geprueft wird nur Redis, und zwar ueber den Status statt ueber ein `PING`
 * (Begruendung wie in der API-Route). Pub/Sub fehlt hier bewusst: ein toter
 * Subscriber ist nicht reparabel und laeuft ueber `markFatal()` in die
 * Liveness (ADR-044), nicht in die Readiness.
 */
const readyRoutes: FastifyPluginAsyncZod = async (fastify, _opts) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/ready",
    schema: readySchema,
    handler: async (_req, res) => {
      const redisStatus = fastify.redis.status;

      if (redisStatus !== REDIS_READY_STATUS) {
        return res.status(503).send({
          status: "not-ready",
          timestamp: new Date().toISOString(),
          reason: `Redis connection is "${redisStatus}"`,
        });
      }

      return res.status(200).send({
        status: "ready",
        timestamp: new Date().toISOString(),
      });
    },
  });
};

export default readyRoutes;
