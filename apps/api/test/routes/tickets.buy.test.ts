// eslint-disable
import * as assert from "node:assert";
import { test } from "vitest";
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
  eval: (
    script: string,
    numKeys: number,
    ...args: string[]
  ) => Promise<number | string>;
  set: (
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ) => Promise<"OK" | null>;
  del: (key: string) => Promise<number>;
  incr: (key: string) => Promise<number>;
};

const ticketAvailabilityKey = (eventId: string) =>
  `tickets:event:${eventId}:available`;
const ticketReservationKey = (eventId: string, orderId: string) =>
  `tickets:event:${eventId}:reservation:${orderId}`;

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

void test("POST /api/tickets/:eventId/buy returns 202 and publishes event", async () => {
  let evalCalls = 0;
  let setCalls = 0;
  let delCalls = 0;
  let incrCalls = 0;
  let publishedPayload: unknown;
  let reservationOrderId: string | undefined;
  const eventId = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";

  const fastify = await setupBuyRouteTest(
    {
      async eval(_script: string, numKeys: number, ...args: string[]) {
        assert.equal(numKeys, 1);
        assert.deepEqual(args, [ticketAvailabilityKey(eventId)]);
        evalCalls += 1;
        return 999_999;
      },
      async set(key: string, value: string, mode: "EX", seconds: number) {
        assert.equal(mode, "EX");
        assert.equal(seconds, 120);
        reservationOrderId = value;
        assert.equal(key, ticketReservationKey(eventId, value));
        setCalls += 1;
        return "OK";
      },
      async del(_key: string) {
        delCalls += 1;
        return 1;
      },
      async incr(key: string) {
        assert.equal(key, ticketAvailabilityKey(eventId));
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
    url: `/api/tickets/${eventId}/buy`,
    payload: {
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
  assert.equal(evalCalls, 1);
  assert.equal(setCalls, 1);
  assert.equal(delCalls, 0);
  assert.equal(incrCalls, 0);
  assert.equal(reservationOrderId, body.orderId);
  assert.deepEqual(publishedPayload, {
    orderId: body.orderId,
    eventId,
    firstName: "Ada",
    lastName: "Lovelace",
  });

  await fastify.close();
});

void test("POST /api/tickets/:eventId/buy returns 409 when sold out", async () => {
  let evalCalls = 0;
  let setCalls = 0;
  let delCalls = 0;
  let incrCalls = 0;
  const eventId = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";

  const fastify = await setupBuyRouteTest(
    {
      async eval(_script: string, numKeys: number, ...args: string[]) {
        assert.equal(numKeys, 1);
        assert.deepEqual(args, [ticketAvailabilityKey(eventId)]);
        evalCalls += 1;
        return -1;
      },
      async set(_key: string, _value: string, _mode: "EX", _seconds: number) {
        setCalls += 1;
        return "OK";
      },
      async del(_key: string) {
        delCalls += 1;
        return 1;
      },
      async incr(key: string) {
        assert.equal(key, ticketAvailabilityKey(eventId));
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
    url: `/api/tickets/${eventId}/buy`,
    payload: {
      firstName: "Ada",
      lastName: "Lovelace",
    },
  });

  assert.equal(res.statusCode, 409);
  const body = JSON.parse(res.body) as { message: string };
  assert.equal(body.message, "Tickets sold out");
  assert.equal(evalCalls, 1);
  assert.equal(setCalls, 0);
  assert.equal(delCalls, 0);
  assert.equal(incrCalls, 0);

  await fastify.close();
});

void test("POST /api/tickets/:eventId/buy validates BuyTicketRequest body", async () => {
  const eventId = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";
  const fastify = await setupBuyRouteTest(
    {
      async eval(_script: string, _numKeys: number, ..._args: string[]) {
        return 999_999;
      },
      async set(_key: string, _value: string, _mode: "EX", _seconds: number) {
        return "OK";
      },
      async del(_key: string) {
        return 1;
      },
      async incr(_key: string) {
        return 1_000_000;
      },
    },
    async (_payload: unknown) => "msg-1",
  );

  const res = await fastify.inject({
    method: "POST",
    url: `/api/tickets/${eventId}/buy`,
    payload: {
      firstName: "",
      lastName: "Lovelace",
    },
  });

  assert.equal(res.statusCode, 400);

  await fastify.close();
});

void test("POST /api/tickets/:eventId/buy rolls back reservation on publish failure", async () => {
  let delCalls = 0;
  let incrCalls = 0;
  let reservationOrderId: string | undefined;
  const eventId = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";

  const fastify = await setupBuyRouteTest(
    {
      async eval(_script: string, numKeys: number, ...args: string[]) {
        assert.equal(numKeys, 1);
        assert.deepEqual(args, [ticketAvailabilityKey(eventId)]);
        return 999_999;
      },
      async set(key: string, value: string, mode: "EX", seconds: number) {
        assert.equal(mode, "EX");
        assert.equal(seconds, 120);
        reservationOrderId = value;
        assert.equal(key, ticketReservationKey(eventId, value));
        return "OK";
      },
      async del(key: string) {
        assert.equal(key, ticketReservationKey(eventId, reservationOrderId!));
        delCalls += 1;
        return 1;
      },
      async incr(key: string) {
        assert.equal(key, ticketAvailabilityKey(eventId));
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
    url: `/api/tickets/${eventId}/buy`,
    payload: {
      firstName: "Ada",
      lastName: "Lovelace",
    },
  });

  assert.equal(res.statusCode, 500);
  assert.equal(delCalls, 1);
  assert.equal(incrCalls, 1);

  await fastify.close();
});
