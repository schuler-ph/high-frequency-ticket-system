import * as assert from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import Redis from "ioredis";
import { env } from "@repo/env";
import { ConflictError, TooEarlyError } from "@repo/types/errors";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import { registerTicketRedisScripts } from "../../src/lib/redis-scripts.ts";
import { queueBuyTicketPurchase } from "../../src/routes/api/tickets/buy.ts";

// Integrationstest zur Zeitquellen-Entscheidung aus Phase 5.2 (ADR-024).
//
// Das Sale-Unlock-Gate vergleicht `opensAt` gegen `nowMs`, und `nowMs` stammt
// aus `Date.now()` des API-Prozesses, der den Request gerade bearbeitet. Bei
// mehreren Replicas ist das pro Pod eine andere Uhr. Dieser Test fuehrt
// mehrere Pods mit kuenstlich versetzten Uhren gegen dasselbe Redis und misst,
// wie breit der Korridor ist, in dem zwei gleichzeitige Kaufversuche
// unterschiedlich beantwortet werden.
//
// Drift auf einem einzelnen Host ist nicht reproduzierbar; der Versatz wird
// deshalb injiziert. Gemessen wird nicht die Drift selbst, sondern ihre
// Uebersetzung in Verhalten: Korridorbreite = Spanne der Pod-Uhren.

let redis: Redis;
let scripts: ReturnType<typeof registerTicketRedisScripts>;

/** Uhrversatz je simuliertem API-Pod, in Millisekunden gegen die echte Zeit. */
const POD_CLOCK_OFFSETS_MS = { fast: 50, exact: 0, slow: -50 } as const;
type PodName = keyof typeof POD_CLOCK_OFFSETS_MS;
const POD_NAMES = Object.keys(POD_CLOCK_OFFSETS_MS) as PodName[];

const SWEEP_STEP_MS = 5;
const SWEEP_RADIUS_MS = 100;

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
  opensAt: number;
  keys: ReturnType<typeof ticketRedisKeys>;
  /** Kauf eines Pods zu einer gegebenen *echten* Wanduhrzeit. */
  buy: (
    pod: PodName,
    trueNowMs: number,
  ) => Promise<"reserved" | "too-early" | "sold-out">;
};

async function seedOpenEvent(
  t: { after: (fn: () => Promise<void> | void) => void },
  available: number,
): Promise<Fixture> {
  const eventId = randomUUID();
  const keys = ticketRedisKeys(eventId);
  // Ein fixer, weit in der Zukunft liegender Verkaufsstart: der Test steuert
  // die Zeit vollstaendig selbst und haengt an keiner echten Uhr.
  const opensAt = Date.now() + 3_600_000;
  const issuedOrderIds: string[] = [];

  await redis.set(keys.available, String(available));
  await redis.set(keys.opensAt, String(opensAt));

  t.after(async () => {
    await redis.del(keys.available, keys.opensAt, keys.reservations);
    if (issuedOrderIds.length > 0) {
      await redis.del(...issuedOrderIds.map(orderRedisKeys.entry));
    }
  });

  const buy = async (pod: PodName, trueNowMs: number) => {
    // Die Pod-Uhr: was dieser Prozess fuer "jetzt" haelt.
    const podNowMs = trueNowMs + POD_CLOCK_OFFSETS_MS[pod];
    try {
      await queueBuyTicketPurchase({
        eventId,
        body: { firstName: "Ada", lastName: "Lovelace" },
        redis: scripts,
        createNow: () => podNowMs,
        createOrderId: () => {
          const orderId = randomUUID();
          issuedOrderIds.push(orderId);
          return orderId;
        },
      });
      return "reserved" as const;
    } catch (error: unknown) {
      if (error instanceof TooEarlyError) return "too-early" as const;
      if (error instanceof ConflictError) return "sold-out" as const;
      throw error;
    }
  };

  return { eventId, opensAt, keys, buy };
}

void test("two pods answer the same instant differently while their clocks disagree", async (t) => {
  const fx = await seedOpenEvent(t, 1_000);

  // Exakt der Moment des Verkaufsstarts — gemessen an einer korrekten Uhr.
  const [fast, exact, slow] = await Promise.all([
    fx.buy("fast", fx.opensAt),
    fx.buy("exact", fx.opensAt),
    fx.buy("slow", fx.opensAt),
  ]);

  assert.equal(fast, "reserved", "a pod whose clock runs ahead already sells");
  assert.equal(exact, "reserved", "at the deadline the sale is open");
  assert.equal(
    slow,
    "too-early",
    "a pod whose clock lags still refuses the very same instant",
  );
});

void test("the unlock corridor is exactly as wide as the spread between pod clocks", async (t) => {
  const fx = await seedOpenEvent(t, 1_000);

  // Fuer jeden Pod den fruehesten *echten* Zeitpunkt suchen, an dem er
  // verkauft. Gemessen, nicht gerechnet: der Sweep faehrt durch das Gate.
  const firstSaleAt: Record<PodName, number | null> = {
    fast: null,
    exact: null,
    slow: null,
  };

  for (
    let offset = -SWEEP_RADIUS_MS;
    offset <= SWEEP_RADIUS_MS;
    offset += SWEEP_STEP_MS
  ) {
    const trueNow = fx.opensAt + offset;
    for (const pod of POD_NAMES) {
      if (firstSaleAt[pod] !== null) continue;
      if ((await fx.buy(pod, trueNow)) === "reserved") {
        firstSaleAt[pod] = trueNow;
      }
    }
  }

  for (const pod of POD_NAMES) {
    assert.notEqual(
      firstSaleAt[pod],
      null,
      `pod ${pod} never opened within the sweep window`,
    );
  }

  const openingTimes = POD_NAMES.map((pod) => firstSaleAt[pod] as number);
  const corridorMs = Math.max(...openingTimes) - Math.min(...openingTimes);
  const clockSpreadMs =
    Math.max(...Object.values(POD_CLOCK_OFFSETS_MS)) -
    Math.min(...Object.values(POD_CLOCK_OFFSETS_MS));

  assert.equal(
    corridorMs,
    clockSpreadMs,
    "the corridor must equal the clock spread, not the deadline length",
  );

  // Die Richtung ist die fachlich interessante Aussage: wer vorgeht, kauft
  // frueher. Der Vorsprung ist systematisch, nicht zufaellig.
  assert.ok(
    (firstSaleAt.fast as number) < (firstSaleAt.slow as number),
    "the pod running ahead must open first",
  );

  t.diagnostic(`clock spread: ${clockSpreadMs} ms`);
  t.diagnostic(`measured unlock corridor: ${corridorMs} ms`);
});

void test("clock drift never lets the inventory go wrong", async (t) => {
  // Die Gegenprobe zur Fairness-Aussage: der Korridor verschiebt, WER kauft,
  // aber nie, WIE VIELE Tickets es gibt. Alle Pods teilen sich denselben
  // atomaren `DECR` — die Uhr entscheidet nur, ob das Script ueberhaupt bis
  // dahin kommt.
  const available = 10;
  const fx = await seedOpenEvent(t, available);

  const attempts = POD_NAMES.flatMap((pod) =>
    Array.from({ length: 20 }, () => fx.buy(pod, fx.opensAt)),
  );
  const results = await Promise.all(attempts);
  const reserved = results.filter((r) => r === "reserved").length;

  assert.equal(
    reserved,
    available,
    "exactly the seeded capacity may be reserved, no matter how clocks disagree",
  );
  assert.equal(
    await redis.get(fx.keys.available),
    "0",
    "available must land exactly at zero",
  );
  assert.equal(
    await redis.zcard(fx.keys.reservations),
    available,
    "the ledger must hold exactly one claim per sold ticket",
  );
});
