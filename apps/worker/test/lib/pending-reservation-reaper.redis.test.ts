import * as assert from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import Redis from "ioredis";
import { env } from "@repo/env";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import {
  registerTicketRedisScripts,
  type TicketRedisScripts,
} from "../../../api/src/lib/redis-scripts.ts";
import {
  registerWorkerRedisScripts,
  type WorkerRedisScripts,
} from "../../src/lib/redis-scripts.ts";

let checkoutRedis: Redis;
let reaperRedis: Redis;
let checkoutScripts: TicketRedisScripts;
let workerScripts: WorkerRedisScripts;

before(async () => {
  checkoutRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  reaperRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  await Promise.all([checkoutRedis.ping(), reaperRedis.ping()]);
  checkoutScripts = registerTicketRedisScripts(
    checkoutRedis as unknown as Parameters<
      typeof registerTicketRedisScripts
    >[0],
  );
  workerScripts = registerWorkerRedisScripts(
    reaperRedis as unknown as Parameters<typeof registerWorkerRedisScripts>[0],
  );
});

after(async () => {
  await Promise.all([checkoutRedis?.quit(), reaperRedis?.quit()]);
});

type Fixture = {
  eventId: string;
  orderId: string;
  keys: ReturnType<typeof ticketRedisKeys>;
  orderKey: string;
};

async function seedDuePending(
  t: { after: (fn: () => Promise<void>) => void },
  deadline = Date.now() - 1,
): Promise<Fixture> {
  const eventId = randomUUID();
  const orderId = randomUUID();
  const keys = ticketRedisKeys(eventId);
  const orderKey = orderRedisKeys.entry(orderId);

  await checkoutRedis.set(keys.available, "0");
  await checkoutRedis.zadd(keys.reservations, deadline, orderId);
  await checkoutRedis.set(
    orderKey,
    JSON.stringify({
      orderId,
      eventId,
      status: "pending",
      firstName: "Ada",
      lastName: "Lovelace",
    }),
  );

  t.after(async () => {
    await checkoutRedis.del(keys.available, keys.reservations, orderKey);
  });

  return { eventId, orderId, keys, orderKey };
}

const reap = (fixture: Fixture, nowMs = Date.now()) =>
  workerScripts.reapPendingReservation(
    fixture.keys.reservations,
    fixture.keys.available,
    fixture.orderKey,
    fixture.orderId,
    nowMs,
  );

void test("reaper never releases before the exact deadline", async (t) => {
  const deadline = Date.now() + 60_000;
  const fixture = await seedDuePending(t, deadline);

  assert.equal(await reap(fixture, deadline - 1), 2);
  assert.equal(await checkoutRedis.get(fixture.keys.available), "0");
  assert.equal(await checkoutRedis.zcard(fixture.keys.reservations), 1);
  assert.ok(await checkoutRedis.get(fixture.orderKey));
});

void test("reaper retains publishing and paid claims", async (t) => {
  const fixture = await seedDuePending(t);
  const [claimed] = await checkoutScripts.claimPayment(
    fixture.orderKey,
    Date.now(),
  );
  assert.equal(claimed, 1);

  assert.equal(await reap(fixture), 4, "publishing is a recovery candidate");
  assert.ok(
    Number(
      await checkoutRedis.zscore(fixture.keys.reservations, fixture.orderId),
    ) > Date.now(),
    "non-pending claims are quarantined outside the due range",
  );
  await checkoutScripts.markPaymentPublished(fixture.orderKey);
  await checkoutRedis.zadd(
    fixture.keys.reservations,
    Date.now() - 1,
    fixture.orderId,
  );
  assert.equal(await reap(fixture), 5, "paid is never age-released");
  assert.equal(await checkoutRedis.get(fixture.keys.available), "0");
  assert.equal(await checkoutRedis.zcard(fixture.keys.reservations), 1);
});

void test("pay and reaper race: exactly one owns the pending claim", async (t) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const fixture = await seedDuePending(t);
    const [payResult, reaperResult] = await Promise.all([
      checkoutScripts.claimPayment(fixture.orderKey, Date.now()),
      reap(fixture),
    ]);

    const payWon = payResult[0] === 1;
    const reaperWon = reaperResult === 1;
    assert.notEqual(payWon, reaperWon, "exactly one transition must win");

    if (payWon) {
      assert.equal(reaperResult, 4);
      assert.equal(await checkoutRedis.get(fixture.keys.available), "0");
      assert.equal(await checkoutRedis.zcard(fixture.keys.reservations), 1);
      assert.equal(
        JSON.parse((await checkoutRedis.get(fixture.orderKey)) ?? "{}").status,
        "publishing",
      );
    } else {
      assert.equal(payResult[0], 0);
      assert.equal(await checkoutRedis.get(fixture.keys.available), "1");
      assert.equal(await checkoutRedis.zcard(fixture.keys.reservations), 0);
      assert.equal(await checkoutRedis.exists(fixture.orderKey), 0);
    }
  }
});

void test("cancel and reaper race without double increment", async (t) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const fixture = await seedDuePending(t);
    const [cancelResult, reaperResult] = await Promise.all([
      checkoutScripts.releaseTicketReservation(
        fixture.keys.reservations,
        fixture.keys.available,
        fixture.orderKey,
        fixture.orderId,
        "pending",
      ),
      reap(fixture),
    ]);

    assert.equal(
      Number(cancelResult === 1) + Number(reaperResult === 1),
      1,
      "one release wins and the other becomes an idempotent no-op",
    );
    assert.equal(await checkoutRedis.get(fixture.keys.available), "1");
    assert.equal(await checkoutRedis.zcard(fixture.keys.reservations), 0);
    assert.equal(await checkoutRedis.exists(fixture.orderKey), 0);

    assert.equal(await reap(fixture), 0);
    assert.equal(
      await checkoutRedis.get(fixture.keys.available),
      "1",
      "repetition must never double-INCR",
    );
  }
});
