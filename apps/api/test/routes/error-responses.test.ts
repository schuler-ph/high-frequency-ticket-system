import * as assert from "node:assert";
import { test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  conflictErrorResponseSchema,
  notFoundErrorResponseSchema,
  tooEarlyErrorResponseSchema,
} from "@repo/types/tickets";
import errorHandler from "../../src/plugins/error-handler.ts";
import ticketBuyRoute from "../../src/routes/api/tickets/buy.ts";
import orderPayRoute from "../../src/routes/api/orders/pay.ts";
import orderCancelRoute from "../../src/routes/api/orders/cancel.ts";

// Verifiziert, dass die in den Routen deklarierten Fehler-Response-Schemas
// (409/425/404) tatsaechlich zu dem passen, was der globale Error-Handler
// sendet — eine Fehlanpassung wuerde die Response-Serialisierung
// (fastify-type-provider-zod) zum 500 eskalieren lassen statt zum erwarteten
// Fehlerstatus (Stage 3, ADR-024-Follow-up).

const EVENT_ID = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";
const ORDER_ID = "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23";

const FAKE_PAYMENT = {
  cardHolder: "Ada Lovelace",
  cardNumber: "4242 4242 4242 4242",
  expiry: "12/30",
  cvc: "123",
};

// Nicht-`pending`-Order (bereits finalisiert) → provoziert ConflictError in
// den Reservierungs-lesenden Routen (Pay/Cancel).
const finalizedOrderJson = JSON.stringify({
  orderId: ORDER_ID,
  eventId: EVENT_ID,
  status: "completed",
  ticketId: "e42628f4-3e01-4098-9696-19f6bb055ac3",
});

async function buildApp(
  route: unknown,
  redis: unknown,
): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.decorate("redis", redis);
  await fastify.register(errorHandler);
  await fastify.register(route as never);
  await fastify.ready();
  return fastify;
}

void test("POST /:eventId/buy serializes 409 (sold out) through conflictErrorResponseSchema", async () => {
  const redis = {
    defineCommand() {},
    async reserveTicket() {
      return -1; // sold out
    },
  };
  const fastify = await buildApp(ticketBuyRoute, redis);

  try {
    const response = await fastify.inject({
      method: "POST",
      url: `/${EVENT_ID}/buy`,
      payload: { firstName: "Ada", lastName: "Lovelace" },
    });

    assert.equal(response.statusCode, 409);
    const body = JSON.parse(response.body);
    assert.equal(conflictErrorResponseSchema.safeParse(body).success, true);
    assert.equal(body.error, "ConflictError");
  } finally {
    await fastify.close();
  }
});

void test("POST /:eventId/buy serializes 425 (too early) through tooEarlyErrorResponseSchema", async () => {
  const redis = {
    defineCommand() {},
    async reserveTicket() {
      return -2; // sale not yet open
    },
  };
  const fastify = await buildApp(ticketBuyRoute, redis);

  try {
    const response = await fastify.inject({
      method: "POST",
      url: `/${EVENT_ID}/buy`,
      payload: { firstName: "Ada", lastName: "Lovelace" },
    });

    assert.equal(response.statusCode, 425);
    const body = JSON.parse(response.body);
    assert.equal(tooEarlyErrorResponseSchema.safeParse(body).success, true);
    assert.equal(body.error, "TooEarlyError");
  } finally {
    await fastify.close();
  }
});

void test("POST /:orderId/pay serializes 404 (missing reservation) through notFoundErrorResponseSchema", async () => {
  const redis = {
    defineCommand() {},
    async get() {
      return null;
    },
    async releaseTicketReservation() {
      return 1;
    },
  };
  const fastify = await buildApp(orderPayRoute, redis);

  try {
    const response = await fastify.inject({
      method: "POST",
      url: `/${ORDER_ID}/pay`,
      payload: FAKE_PAYMENT,
    });

    assert.equal(response.statusCode, 404);
    const body = JSON.parse(response.body);
    assert.equal(notFoundErrorResponseSchema.safeParse(body).success, true);
    assert.equal(body.error, "NotFoundError");
  } finally {
    await fastify.close();
  }
});

void test("POST /:orderId/pay serializes 409 (already finalized) through conflictErrorResponseSchema", async () => {
  const redis = {
    defineCommand() {},
    async get() {
      return finalizedOrderJson;
    },
    async releaseTicketReservation() {
      return 1;
    },
  };
  const fastify = await buildApp(orderPayRoute, redis);

  try {
    const response = await fastify.inject({
      method: "POST",
      url: `/${ORDER_ID}/pay`,
      payload: FAKE_PAYMENT,
    });

    assert.equal(response.statusCode, 409);
    const body = JSON.parse(response.body);
    assert.equal(conflictErrorResponseSchema.safeParse(body).success, true);
    assert.equal(body.error, "ConflictError");
  } finally {
    await fastify.close();
  }
});

void test("POST /:orderId/cancel serializes 409 (already finalized) through conflictErrorResponseSchema", async () => {
  const redis = {
    defineCommand() {},
    async get() {
      return finalizedOrderJson;
    },
    async releaseTicketReservation() {
      return 1;
    },
  };
  const fastify = await buildApp(orderCancelRoute, redis);

  try {
    const response = await fastify.inject({
      method: "POST",
      url: `/${ORDER_ID}/cancel`,
    });

    assert.equal(response.statusCode, 409);
    const body = JSON.parse(response.body);
    assert.equal(conflictErrorResponseSchema.safeParse(body).success, true);
    assert.equal(body.error, "ConflictError");
  } finally {
    await fastify.close();
  }
});
