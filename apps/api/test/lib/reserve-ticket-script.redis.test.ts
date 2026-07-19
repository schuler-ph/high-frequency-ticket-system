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

const PENDING_TTL_SECONDS = 900;

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
  const orderCacheValue = JSON.stringify({
    orderId,
    eventId,
    status: "pending",
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

  return { eventId, orderId, keys, orderCacheKey, orderCacheValue, cleanup };
}

const reserve = (fx: Fixture, nowMs: number) =>
  scripts.reserveTicket(
    fx.keys.available,
    fx.keys.reservations,
    fx.orderCacheKey,
    fx.keys.opensAt,
    fx.orderId,
    fx.orderCacheValue,
    PENDING_TTL_SECONDS,
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
  const ttl = await redis.ttl(fx.orderCacheKey);
  assert.ok(
    ttl > 0 && ttl <= PENDING_TTL_SECONDS,
    `pending order TTL should be set (0 < ttl <= ${PENDING_TTL_SECONDS}), got ${ttl}`,
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
    String(now),
    "ledger score should equal the passed nowMs",
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
