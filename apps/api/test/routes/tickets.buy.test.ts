// eslint-disable
import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import { AppError } from "@repo/types/errors";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import buyRoute from "../../src/routes/api/tickets/buy.js";

function registerLocalErrorHandler(fastify: ReturnType<typeof Fastify>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fastify.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ message: error.message });
    }

    if ((error as { validation?: unknown }).validation) {
      return reply.status(400).send({ message: error.message });
    }

    return reply.status(500).send({ message: error.message });
  });
}

type RedisMock = {
  decr: (key: string) => Promise<number>;
  incr: (key: string) => Promise<number>;
};

async function setupBuyRouteTest(
  redis: RedisMock,
  publishBuyTicket: (payload: unknown) => Promise<string>,
) {
  const fastify = Fastify({ logger: false });

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- For test setup only --- IGNORE ---
  (fastify as any).redis = redis;
  fastify.decorate("pubsubPublisher", { publishBuyTicket });

  registerLocalErrorHandler(fastify);
  await fastify.register(buyRoute, { prefix: "/api/tickets" });
  await fastify.ready();

  return fastify;
}

void test("POST /api/tickets/buy returns 202 and publishes event", async () => {
  let decrCalls = 0;
  let incrCalls = 0;
  let publishedPayload: unknown;

  const fastify = await setupBuyRouteTest(
    {
      async decr(_key: string) {
        decrCalls += 1;
        return 999_999;
      },
      async incr(_key: string) {
        incrCalls += 1;
        return 1_000_000;
      },
    },
    async (payload: unknown) => {
      publishedPayload = payload;
      return "msg-1";
    },
  );

  const res = await fastify.inject({
    method: "POST",
    url: "/api/tickets/buy",
    payload: {
      eventId: "7d4996fe-3f4b-46f6-be95-f7fd38f83f42",
      firstName: "Ada",
      lastName: "Lovelace",
    },
  });

  assert.equal(res.statusCode, 202);
  const body = JSON.parse(res.body) as { message: string; orderId: string };
  assert.equal(body.message, "Ticket purchase queued");
  assert.match(
    body.orderId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  assert.equal(decrCalls, 1);
  assert.equal(incrCalls, 0);
  assert.deepEqual(publishedPayload, {
    orderId: body.orderId,
    eventId: "7d4996fe-3f4b-46f6-be95-f7fd38f83f42",
    firstName: "Ada",
    lastName: "Lovelace",
  });

  await fastify.close();
});

void test("POST /api/tickets/buy returns 409 when sold out", async () => {
  let decrCalls = 0;
  let incrCalls = 0;

  const fastify = await setupBuyRouteTest(
    {
      async decr(_key: string) {
        decrCalls += 1;
        return -1;
      },
      async incr(_key: string) {
        incrCalls += 1;
        return 0;
      },
    },
    async (_payload: unknown) => {
      throw new Error("should not be called");
    },
  );

  const res = await fastify.inject({
    method: "POST",
    url: "/api/tickets/buy",
    payload: {
      eventId: "7d4996fe-3f4b-46f6-be95-f7fd38f83f42",
      firstName: "Ada",
      lastName: "Lovelace",
    },
  });

  assert.equal(res.statusCode, 409);
  const body = JSON.parse(res.body) as { message: string };
  assert.equal(body.message, "Tickets sold out");
  assert.equal(decrCalls, 1);
  assert.equal(incrCalls, 1);

  await fastify.close();
});

void test("POST /api/tickets/buy validates BuyTicketRequest body", async () => {
  const fastify = await setupBuyRouteTest(
    {
      async decr(_key: string) {
        return 999_999;
      },
      async incr(_key: string) {
        return 1_000_000;
      },
    },
    async (_payload: unknown) => "msg-1",
  );

  const res = await fastify.inject({
    method: "POST",
    url: "/api/tickets/buy",
    payload: {
      eventId: "not-a-uuid",
      firstName: "",
      lastName: "Lovelace",
    },
  });

  assert.equal(res.statusCode, 400);

  await fastify.close();
});

void test("POST /api/tickets/buy rolls back reservation on publish failure", async () => {
  let incrCalls = 0;

  const fastify = await setupBuyRouteTest(
    {
      async decr(_key: string) {
        return 999_999;
      },
      async incr(_key: string) {
        incrCalls += 1;
        return 1_000_000;
      },
    },
    async (_payload: unknown) => {
      throw new Error("pubsub unavailable");
    },
  );

  const res = await fastify.inject({
    method: "POST",
    url: "/api/tickets/buy",
    payload: {
      eventId: "7d4996fe-3f4b-46f6-be95-f7fd38f83f42",
      firstName: "Ada",
      lastName: "Lovelace",
    },
  });

  assert.equal(res.statusCode, 500);
  assert.equal(incrCalls, 1);

  await fastify.close();
});
