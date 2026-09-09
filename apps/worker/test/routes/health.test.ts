import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  healthResponseSchema,
  unhealthyResponseSchema,
} from "@repo/types/health";
import serviceHealthPlugin from "../../src/plugins/service-health.ts";
import healthRoutes from "../../src/routes/health.ts";

void test("GET /health returns the health contract", async () => {
  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  await fastify.register(serviceHealthPlugin);
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

void test("GET /health reports 503 once the service is permanently broken", async () => {
  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  await fastify.register(serviceHealthPlugin);
  await fastify.register(healthRoutes);
  await fastify.ready();

  try {
    fastify.serviceHealth.markFatal("Pub/Sub subscription is gone");

    const response = await fastify.inject({ method: "GET", url: "/health" });

    // 503 ist der Punkt: eine Kubernetes-Liveness-Probe startet den Pod damit
    // neu, statt ihn gruen und arbeitslos weiterlaufen zu lassen (ADR-044).
    assert.equal(response.statusCode, 503);

    const body = JSON.parse(response.body);
    assert.equal(unhealthyResponseSchema.safeParse(body).success, true);
    assert.equal(body.status, "unhealthy");
    assert.equal(body.reason, "Pub/Sub subscription is gone");
  } finally {
    await fastify.close();
  }
});
