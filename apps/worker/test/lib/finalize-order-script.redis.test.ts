import * as assert from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import Redis from "ioredis";
import { env } from "@repo/env";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import {
  registerWorkerRedisScripts,
  type WorkerRedisScripts,
} from "../../src/lib/redis-scripts.ts";

// Integrationstest: fuehrt das echte FINALIZE_ORDER_PROCESSING_SCRIPT gegen den
// lokalen `hts-redis`-Container aus — analog zum Reserve-Script-Test in
// apps/api (ADR-024-Follow-up). Die Unit-Tests mocken nur den Rueckgabewert;
// hier wird das tatsaechliche Lua-Verhalten bewiesen, insbesondere das
// Erst-Finalisierung-Signal (ZREM 1 -> 0), auf dem seit Baseline B die
// Unterscheidung completed / duplicate-absorbed beruht (Report §4.3).

let redis: Redis;
let scripts: WorkerRedisScripts;

const ORDER_TTL_SECONDS = 3600;
const PROCESSED_TTL_SECONDS = 86_400;

before(async () => {
  redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  await redis.ping();
  scripts = registerWorkerRedisScripts(
    redis as unknown as Parameters<typeof registerWorkerRedisScripts>[0],
  );
});

after(async () => {
  await redis?.quit();
});

type Fixture = {
  orderId: string;
  keys: ReturnType<typeof ticketRedisKeys>;
  orderCacheKey: string;
  processedKey: string;
};

/** Frische UUID-Keys pro Test, damit im Container keine Restdaten bleiben. */
const createFixture = (): Fixture => {
  const eventId = randomUUID();
  const orderId = randomUUID();
  const keys = ticketRedisKeys(eventId);
  return {
    orderId,
    keys,
    orderCacheKey: orderRedisKeys.entry(orderId),
    processedKey: keys.processed(orderId),
  };
};

const cleanup = async (fixture: Fixture) => {
  await redis.del(
    fixture.orderCacheKey,
    fixture.processedKey,
    fixture.keys.reservations,
  );
};

const finalize = (fixture: Fixture) =>
  scripts.finalizeOrderProcessing(
    fixture.orderCacheKey,
    fixture.processedKey,
    fixture.keys.reservations,
    JSON.stringify({
      orderId: fixture.orderId,
      eventId: "irrelevant-for-this-script",
      status: "completed",
      ticketId: "11111111-1111-4111-8111-111111111111",
    }),
    ORDER_TTL_SECONDS,
    fixture.orderId,
    PROCESSED_TTL_SECONDS,
  );

void test("finalize returns 1 while the ledger claim exists and 0 on a repeat", async () => {
  const fixture = createFixture();
  try {
    // Reserve hat den Anspruch im Ledger angelegt.
    await redis.zadd(fixture.keys.reservations, Date.now(), fixture.orderId);

    assert.equal(
      await finalize(fixture),
      1,
      "first finalize claims the ledger",
    );
    assert.equal(
      await redis.zcard(fixture.keys.reservations),
      0,
      "ledger claim removed",
    );

    // Zweite Auslieferung derselben Nachricht: der Anspruch ist schon weg.
    assert.equal(
      await finalize(fixture),
      0,
      "repeat finalize must report a duplicate, not a sale",
    );
  } finally {
    await cleanup(fixture);
  }
});

void test("finalize still writes order cache and processed marker on a duplicate", async () => {
  const fixture = createFixture();
  try {
    await redis.zadd(fixture.keys.reservations, Date.now(), fixture.orderId);
    await finalize(fixture);
    await redis.del(fixture.orderCacheKey, fixture.processedKey);

    // Rueckgabe 0 heisst "kein zusaetzlicher Verkauf" — die Recovery-Seiteneffekte
    // muessen trotzdem laufen, damit ein Crash zwischen DB-Commit und Finalize
    // durch die Redelivery geheilt wird.
    assert.equal(await finalize(fixture), 0);
    assert.ok(
      await redis.get(fixture.orderCacheKey),
      "order cache rewritten on duplicate",
    );
    assert.equal(
      await redis.get(fixture.processedKey),
      fixture.orderId,
      "processed marker rewritten on duplicate",
    );
  } finally {
    await cleanup(fixture);
  }
});

void test("finalize sets TTLs on both keys it writes", async () => {
  const fixture = createFixture();
  try {
    await redis.zadd(fixture.keys.reservations, Date.now(), fixture.orderId);
    await finalize(fixture);

    const orderTtl = await redis.ttl(fixture.orderCacheKey);
    const processedTtl = await redis.ttl(fixture.processedKey);
    assert.ok(
      orderTtl > 0 && orderTtl <= ORDER_TTL_SECONDS,
      `order cache TTL out of range: ${orderTtl}`,
    );
    assert.ok(
      processedTtl > 0 && processedTtl <= PROCESSED_TTL_SECONDS,
      `processed marker TTL out of range: ${processedTtl}`,
    );
  } finally {
    await cleanup(fixture);
  }
});
