import * as assert from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import Redis from "ioredis";
import { env } from "@repo/env";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import {
  registerTicketRedisScripts,
  type TicketRedisScripts,
} from "../../src/lib/redis-scripts.ts";

// Integrationstest: fuehrt das echte RESERVE_TICKET_SCRIPT gegen den lokalen
// `hts-redis`-Container aus (ADR-024-Follow-up). Die Unit-Tests in
// tickets.buy.test.ts mocken nur den `-2`/`-1`-Rueckgabewert; hier verifizieren
// wir das tatsaechliche Lua-Verhalten des Sale-Unlock-Gates inkl. der
// Nebeneffekte (DECR/ZADD/SET) — und beweisen, dass die beiden Fehlerpfade
// (-2 = zu frueh, -1 = ausverkauft) NICHTS schreiben.

let redis: Redis;
let scripts: TicketRedisScripts;

const PENDING_TIMEOUT_SECONDS = 900;

before(async () => {
  redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  await redis.ping();
  scripts = registerTicketRedisScripts(
    redis as unknown as Parameters<typeof registerTicketRedisScripts>[0],
  );
});

after(async () => {
  await redis?.quit();
});

type Fixture = {
  eventId: string;
  orderId: string;
  keys: ReturnType<typeof ticketRedisKeys>;
  orderCacheKey: string;
  orderCacheValue: string;
  expiresAt: number;
  cleanup: () => Promise<void>;
};

/**
 * Frische, kollisionsfreie Keys pro Test plus registrierte Aufraeum-Funktion.
 * Setzt `available` und – falls angegeben – `opensAt`; laesst den `opensAt`-Key
 * bewusst weg, wenn `opensAt === undefined`, um den "Key fehlt"-Fall zu testen.
 */
async function seedFixture(
  t: { after: (fn: () => Promise<void> | void) => void },
  available: number,
  opensAt?: number,
): Promise<Fixture> {
  const eventId = randomUUID();
  const orderId = randomUUID();
  const keys = ticketRedisKeys(eventId);
  const orderCacheKey = orderRedisKeys.entry(orderId);
  // Score und Record tragen dieselbe Deadline — genau wie in der Buy-Route.
  const expiresAt = Date.now() + PENDING_TIMEOUT_SECONDS * 1000;
  const orderCacheValue = JSON.stringify({
    orderId,
    eventId,
    status: "pending",
    expiresAt,
    firstName: "Ada",
    lastName: "Lovelace",
  });

  await redis.set(keys.available, String(available));
  if (opensAt !== undefined) {
    await redis.set(keys.opensAt, String(opensAt));
  }

  const cleanup = async () => {
    await redis.del(
      keys.available,
      keys.opensAt,
      keys.reservations,
      orderCacheKey,
    );
  };
  t.after(cleanup);

  return {
    eventId,
    orderId,
    keys,
    orderCacheKey,
    orderCacheValue,
    expiresAt,
    cleanup,
  };
}

// Die Deadline rechnet der Aufrufer, nicht das Script — hier derselbe Wert, der
// auch im Record steht.
const reserve = (fx: Fixture, nowMs: number) =>
  scripts.reserveTicket(
    fx.keys.available,
    fx.keys.reservations,
    fx.orderCacheKey,
    fx.keys.opensAt,
    fx.orderId,
    fx.orderCacheValue,
    fx.expiresAt,
    nowMs,
  );

async function assertReserved(fx: Fixture, expectedRemaining: number) {
  assert.equal(
    await redis.get(fx.keys.available),
    String(expectedRemaining),
    "available should be decremented",
  );
  assert.equal(
    await redis.zcard(fx.keys.reservations),
    1,
    "ledger should hold exactly one reservation",
  );
  assert.equal(
    await redis.get(fx.orderCacheKey),
    fx.orderCacheValue,
    "pending order record should be written",
  );
  assert.equal(
    await redis.ttl(fx.orderCacheKey),
    -1,
    "pending state must remain until cancel, pay, worker, or reaper decides it",
  );
}

async function assertNoWrites(fx: Fixture, expectedAvailable: number) {
  assert.equal(
    await redis.get(fx.keys.available),
    String(expectedAvailable),
    "available must be untouched on an early return",
  );
  assert.equal(
    await redis.zcard(fx.keys.reservations),
    0,
    "ledger must stay empty on an early return",
  );
  assert.equal(
    await redis.exists(fx.orderCacheKey),
    0,
    "no pending order record must be written on an early return",
  );
}

void test("reserve succeeds when the opensAt key is absent (event immediately open)", async (t) => {
  const fx = await seedFixture(t, 5 /* available */ /* no opensAt */);
  const now = Date.now();

  const remaining = await reserve(fx, now);

  assert.equal(remaining, 4);
  await assertReserved(fx, 4);
  assert.equal(
    await redis.zscore(fx.keys.reservations, fx.orderId),
    String(fx.expiresAt),
    "ledger score should equal the exact eligibility deadline from the record",
  );
});

void test("reserve succeeds when opensAt is 0 (gate disabled)", async (t) => {
  const fx = await seedFixture(t, 5, 0);

  const remaining = await reserve(fx, Date.now());

  assert.equal(remaining, 4);
  await assertReserved(fx, 4);
});

void test("reserve returns -2 and writes nothing when nowMs is before opensAt", async (t) => {
  const now = Date.now();
  const fx = await seedFixture(t, 5, now + 60_000 /* opens in 60s */);

  const result = await reserve(fx, now);

  assert.equal(result, -2, "sale not yet open → -2 (TooEarly)");
  await assertNoWrites(fx, 5);
});

void test("reserve succeeds when nowMs is at/after opensAt", async (t) => {
  const now = Date.now();
  const fx = await seedFixture(t, 5, now - 1_000 /* opened 1s ago */);

  const remaining = await reserve(fx, now);

  assert.equal(remaining, 4);
  await assertReserved(fx, 4);
});

void test("reserve returns -1 and writes nothing when sold out (even if open)", async (t) => {
  const fx = await seedFixture(t, 0, 0);

  const result = await reserve(fx, Date.now());

  assert.equal(result, -1, "sold out → -1");
  await assertNoWrites(fx, 0);
});

void test("pay atomically claims pending → publishing and then marks paid", async (t) => {
  const fx = await seedFixture(t, 5, 0);
  await reserve(fx, Date.now());
  const queuedAt = 1_700_000_000_000;

  const [claimed, claimedRaw] = await scripts.claimPayment(
    fx.orderCacheKey,
    queuedAt,
    Date.now(),
  );

  assert.equal(claimed, 1);
  assert.ok(claimedRaw);
  assert.deepEqual(JSON.parse(claimedRaw), {
    orderId: fx.orderId,
    eventId: fx.eventId,
    status: "publishing",
    expiresAt: fx.expiresAt,
    firstName: "Ada",
    lastName: "Lovelace",
    queuedAt,
  });
  assert.equal(
    await redis.ttl(fx.orderCacheKey),
    -1,
    "publishing state must not expire before the worker/recovery decides it",
  );

  const duplicateClaim = await scripts.claimPayment(
    fx.orderCacheKey,
    queuedAt + 1,
    Date.now(),
  );
  assert.equal(duplicateClaim[0], -1, "a second pay must not publish again");

  assert.equal(await scripts.markPaymentPublished(fx.orderCacheKey), 1);
  assert.equal(
    JSON.parse((await redis.get(fx.orderCacheKey)) ?? "{}").status,
    "paid",
  );
  assert.equal(await scripts.markPaymentPublished(fx.orderCacheKey), 0);
});

void test("pay is refused once the eligibility deadline has passed", async (t) => {
  const fx = await seedFixture(t, 5, 0);
  await reserve(fx, Date.now());

  // Exakt auf der Deadline gilt der Anspruch bereits als faellig — dieselbe
  // Grenze, die auch der Reaper anlegt. Es darf keinen Moment geben, in dem Pay
  // noch zusagt und der Reaper schon freigeben duerfte.
  const [onDeadline] = await scripts.claimPayment(
    fx.orderCacheKey,
    fx.expiresAt,
    fx.expiresAt,
  );
  assert.equal(onDeadline, -2, "claim exactly at the deadline must be refused");

  const [afterDeadline, raw] = await scripts.claimPayment(
    fx.orderCacheKey,
    fx.expiresAt + 60_000,
    fx.expiresAt + 60_000,
  );
  assert.equal(afterDeadline, -2);
  assert.ok(raw, "the refused claim returns the untouched record");
  assert.equal(JSON.parse(raw).status, "pending");

  // Die Ablehnung gibt nichts frei: das bleibt allein Sache des Reapers.
  assert.equal(
    await redis.get(fx.orderCacheKey),
    fx.orderCacheValue,
    "a refused claim must not modify the record",
  );
  assert.equal(await redis.get(fx.keys.available), "4");
  assert.equal(await redis.zcard(fx.keys.reservations), 1);
});

void test("pay still works for a record without expiresAt", async (t) => {
  const fx = await seedFixture(t, 5, 0);
  // Reservierung aus der Zeit vor dem Feld: Ledger-Score ja, Record-Feld nein.
  const legacyValue = JSON.stringify({
    orderId: fx.orderId,
    eventId: fx.eventId,
    status: "pending",
    firstName: "Ada",
    lastName: "Lovelace",
  });
  await scripts.reserveTicket(
    fx.keys.available,
    fx.keys.reservations,
    fx.orderCacheKey,
    fx.keys.opensAt,
    fx.orderId,
    legacyValue,
    fx.expiresAt,
    Date.now(),
  );

  const [claimed] = await scripts.claimPayment(
    fx.orderCacheKey,
    Date.now(),
    fx.expiresAt + 60_000,
  );
  assert.equal(claimed, 1, "a record without a deadline is treated as open");
});

void test("cancel cannot release a publishing or paid reservation", async (t) => {
  const fx = await seedFixture(t, 5, 0);
  await reserve(fx, Date.now());
  await scripts.claimPayment(fx.orderCacheKey, Date.now(), Date.now());

  const cancelPublishing = await scripts.releaseTicketReservation(
    fx.keys.reservations,
    fx.keys.available,
    fx.orderCacheKey,
    fx.orderId,
    "pending",
  );
  assert.equal(cancelPublishing, -1);
  assert.equal(await redis.get(fx.keys.available), "4");
  assert.equal(await redis.zcard(fx.keys.reservations), 1);

  await scripts.markPaymentPublished(fx.orderCacheKey);
  const cancelPaid = await scripts.releaseTicketReservation(
    fx.keys.reservations,
    fx.keys.available,
    fx.orderCacheKey,
    fx.orderId,
    "pending",
  );
  assert.equal(cancelPaid, -1);
  assert.equal(await redis.get(fx.keys.available), "4");
  assert.equal(await redis.zcard(fx.keys.reservations), 1);
});

void test("publish rollback releases only the owned publishing claim once", async (t) => {
  const fx = await seedFixture(t, 5, 0);
  await reserve(fx, Date.now());
  await scripts.claimPayment(fx.orderCacheKey, Date.now(), Date.now());

  const released = await scripts.releaseTicketReservation(
    fx.keys.reservations,
    fx.keys.available,
    fx.orderCacheKey,
    fx.orderId,
    "publishing",
  );
  const repeated = await scripts.releaseTicketReservation(
    fx.keys.reservations,
    fx.keys.available,
    fx.orderCacheKey,
    fx.orderId,
    "publishing",
  );

  assert.equal(released, 1);
  assert.equal(repeated, 0);
  assert.equal(await redis.get(fx.keys.available), "5");
  assert.equal(await redis.zcard(fx.keys.reservations), 0);
  assert.equal(await redis.exists(fx.orderCacheKey), 0);
});
