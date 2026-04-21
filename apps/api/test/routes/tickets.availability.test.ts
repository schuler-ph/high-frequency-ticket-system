import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { ticketAvailabilityResponseSchema } from "@repo/types/tickets";
import ticketAvailabilityRoute from "../../src/routes/api/tickets/availability.ts";

type RedisMock = {
  mget: (...keys: string[]) => Promise<[string | null, string | null]>;
};

const eventId = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";

void test("GET /:eventId/availability returns numeric availability counts", async () => {
  const fastify = Fastify({ logger: false });
  const redis: RedisMock = {
    async mget(...keys: string[]) {
      assert.deepEqual(keys, [
        `tickets:event:${eventId}:total`,
        `tickets:event:${eventId}:available`,
      ]);

      return ["1000000", "843291"];
    },
  };

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis);
  await fastify.register(ticketAvailabilityRoute);
  await fastify.ready();

  try {
    const response = await fastify.inject({
      method: "GET",
      url: `/${eventId}/availability`,
    });

    assert.equal(response.statusCode, 200);

    const body = JSON.parse(response.body);
    const parsedBody = ticketAvailabilityResponseSchema.safeParse(body);

    assert.equal(parsedBody.success, true);
    assert.deepEqual(body, {
      available: 843_291,
      total: 1_000_000,
    });
  } finally {
    await fastify.close();
  }
});

void test("GET /:eventId/availability preserves missing counters as null", async () => {
  const fastify = Fastify({ logger: false });
  const redis: RedisMock = {
    async mget(...keys: string[]) {
      assert.deepEqual(keys, [
        `tickets:event:${eventId}:total`,
        `tickets:event:${eventId}:available`,
      ]);

      return [null, null];
    },
  };

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis);
  await fastify.register(ticketAvailabilityRoute);
  await fastify.ready();

  try {
    const response = await fastify.inject({
      method: "GET",
      url: `/${eventId}/availability`,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      available: null,
      total: null,
    });
  } finally {
    await fastify.close();
  }
});
