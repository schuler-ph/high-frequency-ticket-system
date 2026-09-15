import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  notReadyResponseSchema,
  readyResponseSchema,
} from "@repo/types/health";
import readyRoutes from "../../src/routes/ready.ts";

/**
 * Die Route liest genau eine Eigenschaft des Clients. Ein echter Redis macht
 * den Test von einem laufenden Container abhaengig, ohne mehr zu beweisen.
 */
const buildAppWithRedisStatus = async (
  status: string,
): Promise<FastifyInstance> => {
  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", { status } as unknown as FastifyInstance["redis"]);
  await fastify.register(readyRoutes);
  await fastify.ready();
  return fastify;
};

void test("GET /ready reports ready while Redis is connected", async () => {
  const fastify = await buildAppWithRedisStatus("ready");

  try {
    const response = await fastify.inject({ method: "GET", url: "/ready" });

    assert.equal(response.statusCode, 200);

    const body = JSON.parse(response.body);
    assert.equal(readyResponseSchema.safeParse(body).success, true);
    assert.equal(body.status, "ready");
  } finally {
    await fastify.close();
  }
});

void test("GET /ready reports 503 while Redis is unreachable", async () => {
  const fastify = await buildAppWithRedisStatus("reconnecting");

  try {
    const response = await fastify.inject({ method: "GET", url: "/ready" });

    // 503 nimmt den Pod aus den Service-Endpoints. Dass er dabei *nicht*
    // neugestartet wird, ist der Punkt der Trennung zu `/health` (ADR-044).
    assert.equal(response.statusCode, 503);

    const body = JSON.parse(response.body);
    assert.equal(notReadyResponseSchema.safeParse(body).success, true);
    assert.equal(body.status, "not-ready");
    assert.match(body.reason, /reconnecting/);
  } finally {
    await fastify.close();
  }
});
