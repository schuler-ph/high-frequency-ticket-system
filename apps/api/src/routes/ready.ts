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
 * Readiness-Endpunkt. Beantwortet "darf dieser Pod Traffic bekommen?" und
 * damit bewusst nicht dieselbe Frage wie `/health` (ADR-044).
 *
 * Geprueft wird Redis, weil alle API-Read-Modelle — Verfuegbarkeit und
 * Order-Status — von dort kommen: ohne Redis liefert der Pod nur Fehler und
 * gehoert aus den Service-Endpoints genommen. Er gehoert aber *nicht*
 * neugestartet; ioredis verbindet sich von selbst neu, und eine Liveness auf
 * derselben Pruefung wuerde bei einem Redis-Ausfall alle API-Pods in eine
 * Neustart-Schleife schicken.
 *
 * Bewusst der Status statt eines `PING`: @fastify/redis faehrt ioredis mit
 * aktivierter Offline-Queue, ein `PING` bei toter Verbindung wird also
 * eingereiht statt abgelehnt und laeuft erst in den Probe-Timeout. Der Status
 * ist synchron, kostet kein Round-Trip pro Probe-Intervall und luegt nicht.
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
