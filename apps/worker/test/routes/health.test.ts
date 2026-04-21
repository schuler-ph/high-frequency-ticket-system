import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { healthResponseSchema } from "@repo/types/health";
import healthRoutes from "../../src/routes/health.ts";

void test("GET /health returns the health contract", async () => {
  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  await fastify.register(healthRoutes);
  await fastify.ready();

  try {
    const response = await fastify.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 200);

    const body = JSON.parse(response.body);
    const parsedBody = healthResponseSchema.safeParse(body);

    assert.equal(parsedBody.success, true);
    assert.equal(body.status, "ok");
    assert.equal(typeof body.uptime, "number");
  } finally {
    await fastify.close();
  }
});
