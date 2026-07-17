import * as assert from "node:assert";
import { test } from "node:test";
import {
  buyTicketBodySchema,
  pendingOrderReservationSchema,
} from "@repo/types/tickets";
import { ConflictError, TooEarlyError } from "@repo/types/errors";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import { queueBuyTicketPurchase } from "../../src/routes/api/tickets/buy.ts";
import {
  registerTicketRedisScripts,
  type TicketRedisScripts,
} from "../../src/lib/redis-scripts.ts";

const EVENT_ID = "7d4996fe-3f4b-46f6-be95-f7fd38f83f42";
const ORDER_ID = "8d0f0f65-6a97-48a3-ad0b-65f65b0d9c23";

type ReserveCall = {
  availableKey: string;
  reservationsLedgerKey: string;
  orderCacheKey: string;
  opensAtKey: string;
  orderId: string;
  orderCacheValue: string;
  pendingOrderTtlSeconds: number;
  nowMs: number;
};

type ReleaseCall = {
  reservationsLedgerKey: string;
  availableKey: string;
  orderCacheKey: string;
  orderId: string;
};

function createScriptsMock(
  overrides: Partial<TicketRedisScripts> = {},
): TicketRedisScripts & {
  reserveCalls: ReserveCall[];
  releaseCalls: ReleaseCall[];
} {
  const reserveCalls: ReserveCall[] = [];
  const releaseCalls: ReleaseCall[] = [];

  return {
    reserveCalls,
    releaseCalls,
    async reserveTicket(
      availableKey,
      reservationsLedgerKey,
      orderCacheKey,
      opensAtKey,
      orderId,
      orderCacheValue,
      pendingOrderTtlSeconds,
      nowMs,
    ) {
      reserveCalls.push({
        availableKey,
        reservationsLedgerKey,
        orderCacheKey,
        opensAtKey,
        orderId,
        orderCacheValue,
        pendingOrderTtlSeconds,
        nowMs,
      });
      return 999_999;
    },
    async releaseTicketReservation(
      reservationsLedgerKey,
      availableKey,
      orderCacheKey,
      orderId,
    ) {
      releaseCalls.push({
        reservationsLedgerKey,
        availableKey,
        orderCacheKey,
        orderId,
      });
      return 1;
    },
    ...overrides,
  };
}

void test("queueBuyTicketPurchase reserves atomically in one script call and does not publish", async () => {
  const redis = createScriptsMock();

  const response = await queueBuyTicketPurchase({
    eventId: EVENT_ID,
    body: {
      firstName: "Ada",
      lastName: "Lovelace",
    },
    redis,
    createOrderId: () => ORDER_ID,
  });

  assert.equal(response.message, "Ticket reserved");
  assert.equal(response.orderId, ORDER_ID);
  assert.equal(redis.reserveCalls.length, 1);
  const reserveCall = redis.reserveCalls[0];
  assert.ok(reserveCall);
  assert.deepEqual(
    { ...reserveCall, nowMs: undefined },
    {
      availableKey: ticketRedisKeys(EVENT_ID).available,
      reservationsLedgerKey: ticketRedisKeys(EVENT_ID).reservations,
      orderCacheKey: orderRedisKeys.entry(ORDER_ID),
      opensAtKey: ticketRedisKeys(EVENT_ID).opensAt,
      orderId: ORDER_ID,
      // Der Reservierungs-Record traegt die Kaeuferdaten fuer die Pay-Route.
      orderCacheValue: JSON.stringify(
        pendingOrderReservationSchema.parse({
          orderId: ORDER_ID,
          eventId: EVENT_ID,
          status: "pending",
          firstName: "Ada",
          lastName: "Lovelace",
        }),
      ),
      pendingOrderTtlSeconds: 900,
      nowMs: undefined,
    },
  );
  assert.ok(
    typeof reserveCall.nowMs === "number" && reserveCall.nowMs > 0,
    `expected nowMs > 0, got ${String(reserveCall.nowMs)}`,
  );
  // Buy publiziert nichts mehr und rollt daher auch nichts zurueck (ADR-028).
  assert.equal(redis.releaseCalls.length, 0);
});

void test("queueBuyTicketPurchase throws ConflictError when sold out", async () => {
  const redis = createScriptsMock({
    reserveTicket: async () => -1,
  });

  await assert.rejects(
    () =>
      queueBuyTicketPurchase({
        eventId: EVENT_ID,
        body: {
          firstName: "Ada",
          lastName: "Lovelace",
        },
        redis,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.message, "Tickets sold out");
      return true;
    },
  );

  assert.equal(redis.releaseCalls.length, 0);
});

void test("queueBuyTicketPurchase throws TooEarlyError when the sale is not yet open", async () => {
  const redis = createScriptsMock({
    reserveTicket: async () => -2,
  });

  await assert.rejects(
    () =>
      queueBuyTicketPurchase({
        eventId: EVENT_ID,
        body: {
          firstName: "Ada",
          lastName: "Lovelace",
        },
        redis,
      }),
    (error: unknown) => {
      assert.ok(error instanceof TooEarlyError);
      assert.equal(error.message, "Tickets are not yet on sale");
      return true;
    },
  );

  assert.equal(redis.releaseCalls.length, 0);
});

void test("buyTicketBodySchema validates request body", () => {
  const result = buyTicketBodySchema.safeParse({
    firstName: "",
    lastName: "Lovelace",
  });

  assert.equal(result.success, false);
});

void test("registerTicketRedisScripts registers both scripts once via defineCommand", () => {
  const definedCommands: Array<{ name: string; numberOfKeys?: number }> = [];

  const scripts = registerTicketRedisScripts({
    defineCommand(name, definition) {
      definedCommands.push({ name, numberOfKeys: definition.numberOfKeys });
    },
  });

  assert.ok(scripts);
  assert.deepEqual(definedCommands, [
    { name: "reserveTicket", numberOfKeys: 4 },
    { name: "releaseTicketReservation", numberOfKeys: 3 },
  ]);
});
