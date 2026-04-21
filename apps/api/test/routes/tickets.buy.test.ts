import * as assert from "node:assert";
import { test } from "node:test";
import { buyTicketBodySchema } from "@repo/types/tickets";
import { ConflictError } from "@repo/types/errors";
import { queueBuyTicketPurchase } from "../../src/routes/api/tickets/buy.ts";

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

void test("queueBuyTicketPurchase returns queued payload and publishes event", async () => {
  let evalCalls = 0;
  let setCalls = 0;
  let delCalls = 0;
  let incrCalls = 0;
  let publishedPayload: unknown;
  let reservationOrderId: string | undefined;
  const eventId = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";

  const response = await queueBuyTicketPurchase({
    eventId,
    body: {
      firstName: "Ada",
      lastName: "Lovelace",
    },
    redis: {
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
    } satisfies RedisMock,
    pubsubPublisher: {
      async publishBuyTicket(payload) {
        publishedPayload = payload;
        return "msg-1";
      },
    },
  });

  assert.equal(response.message, "Ticket purchase queued");
  assert.match(
    response.orderId!,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  assert.equal(evalCalls, 1);
  assert.equal(setCalls, 1);
  assert.equal(delCalls, 0);
  assert.equal(incrCalls, 0);
  assert.equal(reservationOrderId, response.orderId);
  assert.deepEqual(publishedPayload, {
    orderId: response.orderId,
    eventId,
    firstName: "Ada",
    lastName: "Lovelace",
  });
});

void test("queueBuyTicketPurchase throws ConflictError when sold out", async () => {
  let evalCalls = 0;
  let setCalls = 0;
  let delCalls = 0;
  let incrCalls = 0;
  const eventId = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";

  await assert.rejects(
    () =>
      queueBuyTicketPurchase({
        eventId,
        body: {
          firstName: "Ada",
          lastName: "Lovelace",
        },
        redis: {
          async eval(_script: string, numKeys: number, ...args: string[]) {
            assert.equal(numKeys, 1);
            assert.deepEqual(args, [ticketAvailabilityKey(eventId)]);
            evalCalls += 1;
            return -1;
          },
          async set(
            _key: string,
            _value: string,
            _mode: "EX",
            _seconds: number,
          ) {
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
        } satisfies RedisMock,
        pubsubPublisher: {
          async publishBuyTicket() {
            throw new Error("should not be called");
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.message, "Tickets sold out");
      return true;
    },
  );

  assert.equal(evalCalls, 1);
  assert.equal(setCalls, 0);
  assert.equal(delCalls, 0);
  assert.equal(incrCalls, 0);
});

void test("buyTicketBodySchema validates request body", () => {
  const result = buyTicketBodySchema.safeParse({
    firstName: "",
    lastName: "Lovelace",
  });

  assert.equal(result.success, false);
});

void test("queueBuyTicketPurchase rolls back reservation on publish failure", async () => {
  let delCalls = 0;
  let incrCalls = 0;
  let reservationOrderId: string | undefined;
  const eventId = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";

  await assert.rejects(
    () =>
      queueBuyTicketPurchase({
        eventId,
        body: {
          firstName: "Ada",
          lastName: "Lovelace",
        },
        redis: {
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
            assert.equal(
              key,
              ticketReservationKey(eventId, reservationOrderId!),
            );
            delCalls += 1;
            return 1;
          },
          async incr(key: string) {
            assert.equal(key, ticketAvailabilityKey(eventId));
            incrCalls += 1;
            return 1_000_000;
          },
        } satisfies RedisMock,
        pubsubPublisher: {
          async publishBuyTicket() {
            throw new Error("pubsub unavailable");
          },
        },
      }),
    /pubsub unavailable/,
  );

  assert.equal(delCalls, 1);
  assert.equal(incrCalls, 1);
});
