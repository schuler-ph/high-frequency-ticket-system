import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  orderStatusNotFoundResponseSchema,
  orderStatusResponseSchema,
} from "@repo/types/tickets";
import errorHandler from "../../src/plugins/error-handler.ts";
import orderStatusRoute from "../../src/routes/api/orders/status.ts";

type RedisMock = {
  get: (key: string) => Promise<string | null>;
};

const pendingOrderId = "1f7a58e2-e676-44a8-bc48-9c0d8a130a4f";
const completedOrderId = "ca2c8ff9-f1f4-4f65-a7ff-1f10baf50ec0";
const failedOrderId = "ff8324b1-fa61-4b43-b3eb-4db5f1d7769d";

void test("GET /:orderId returns a pending order from Redis", async () => {
  const fastify = Fastify({ logger: false });
  const redis: RedisMock = {
    async get(key: string) {
      assert.equal(key, `orders:${pendingOrderId}`);

      return JSON.stringify({
        orderId: pendingOrderId,
        eventId: "7d4996fe-3f4b-46f6-be95-f7fd38f83f42",
        status: "pending",
      });
    },
  };

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis);
  await fastify.register(orderStatusRoute);
  await fastify.ready();

  try {
    const response = await fastify.inject({
      method: "GET",
      url: `/${pendingOrderId}`,
    });

    assert.equal(response.statusCode, 200);

    const body = JSON.parse(response.body);
    const parsedBody = orderStatusResponseSchema.safeParse(body);

    assert.equal(parsedBody.success, true);
    assert.deepEqual(body, {
      orderId: pendingOrderId,
      eventId: "7d4996fe-3f4b-46f6-be95-f7fd38f83f42",
      status: "pending",
    });
  } finally {
    await fastify.close();
  }
});

void test("GET /:orderId returns a completed order with ticket reference from Redis", async () => {
  const fastify = Fastify({ logger: false });
  const redis: RedisMock = {
    async get(key: string) {
      assert.equal(key, `orders:${completedOrderId}`);

      return JSON.stringify({
        orderId: completedOrderId,
        eventId: "7d4996fe-3f4b-46f6-be95-f7fd38f83f42",
        status: "completed",
        ticketId: "e42628f4-3e01-4098-9696-19f6bb055ac3",
      });
    },
  };

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis);
  await fastify.register(orderStatusRoute);
  await fastify.ready();

  try {
    const response = await fastify.inject({
      method: "GET",
      url: `/${completedOrderId}`,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      orderId: completedOrderId,
      eventId: "7d4996fe-3f4b-46f6-be95-f7fd38f83f42",
      status: "completed",
      ticketId: "e42628f4-3e01-4098-9696-19f6bb055ac3",
    });
  } finally {
    await fastify.close();
  }
});

void test("GET /:orderId returns a failed order from Redis", async () => {
  const fastify = Fastify({ logger: false });
  const redis: RedisMock = {
    async get(key: string) {
      assert.equal(key, `orders:${failedOrderId}`);

      return JSON.stringify({
        orderId: failedOrderId,
        eventId: "7d4996fe-3f4b-46f6-be95-f7fd38f83f42",
        status: "failed",
        failureReason: "Event not found",
      });
    },
  };

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis);
  await fastify.register(orderStatusRoute);
  await fastify.ready();

  try {
    const response = await fastify.inject({
      method: "GET",
      url: `/${failedOrderId}`,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      orderId: failedOrderId,
      eventId: "7d4996fe-3f4b-46f6-be95-f7fd38f83f42",
      status: "failed",
      failureReason: "Event not found",
    });
  } finally {
    await fastify.close();
  }
});

void test("GET /:orderId returns 404 when the order is missing from Redis", async () => {
  const fastify = Fastify({ logger: false });
  const missingOrderId = "f4e9975d-6fd9-4359-adf3-6f9a7ecbc3b0";
  const redis: RedisMock = {
    async get(key: string) {
      assert.equal(key, `orders:${missingOrderId}`);
      return null;
    },
  };

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis);
  await fastify.register(errorHandler);
  await fastify.register(orderStatusRoute);
  await fastify.ready();

  try {
    const response = await fastify.inject({
      method: "GET",
      url: `/${missingOrderId}`,
    });

    assert.equal(response.statusCode, 404);

    const body = JSON.parse(response.body);
    const parsedBody = orderStatusNotFoundResponseSchema.safeParse(body);

    assert.equal(parsedBody.success, true);
    assert.equal(body.message, `Order ${missingOrderId} not found`);
  } finally {
    await fastify.close();
  }
});
