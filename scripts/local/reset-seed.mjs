import { execFileSync, execSync } from "node:child_process";

const POSTGRES_CONTAINER = "hts-postgres";
const REDIS_CONTAINER = "hts-redis";
const PUBSUB_CONTAINER = "hts-pubsub";
const POSTGRES_DB = "high_frequency_tickets";
const POSTGRES_USER = "postgres";

const DEFAULT_PROJECT_ID = "high-frequency-ticket-system";
const DEFAULT_PUBSUB_TOPIC = "buy-ticket";
const DEFAULT_PUBSUB_SUBSCRIPTION = "buy-ticket-worker";
const DEFAULT_PUBSUB_HOST = "localhost:10005";
const DEFAULT_DATABASE_URL =
  "postgres://postgres:postgres@localhost:10006/high_frequency_tickets";
const SEED_TIMESTAMP = "2026-01-01T00:00:00Z";

// Kapazitaet des Haupt-Events. Default 1.000.000 (Lastprofil laut ARCHITECTURE.md
// und ADR-025). Fuer schnelle Smoke-Tests der Sold-Out-Transition (z.B. den
// reaktiven SIGINT-Stop in run-spike.mjs oder eine CI-Smoke-Profile) kann eine
// kleine Kapazitaet via `SEED_CAPACITY` gesetzt werden, ohne das Fixture zu
// veraendern.
const SEED_CAPACITY = Number(process.env.SEED_CAPACITY ?? 1_000_000);

if (!Number.isInteger(SEED_CAPACITY) || SEED_CAPACITY <= 0) {
  throw new Error(
    `SEED_CAPACITY must be a positive integer, got ${JSON.stringify(process.env.SEED_CAPACITY)}`,
  );
}

const EVENT_FIXTURES = [
  {
    id: "00000000-0000-4000-8000-000000000000",
    name: "Frequency Festival 20XX Main Sale",
    totalCapacity: SEED_CAPACITY,
    soldCount: 0,
    available: SEED_CAPACITY,
  },
];

const ORDER_FIXTURES = [];

const TICKET_FIXTURES = [];

const requiredContainers = [
  POSTGRES_CONTAINER,
  REDIS_CONTAINER,
  PUBSUB_CONTAINER,
];

const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? DEFAULT_PROJECT_ID;
const topicName = process.env.PUBSUB_TOPIC_BUY_TICKET ?? DEFAULT_PUBSUB_TOPIC;
const subscriptionName =
  process.env.PUBSUB_SUBSCRIPTION_BUY_TICKET ?? DEFAULT_PUBSUB_SUBSCRIPTION;
const pubsubHost = process.env.PUBSUB_EMULATOR_HOST ?? DEFAULT_PUBSUB_HOST;

// Optionales Sale-Unlock-Gate fuer Lasttests: > 0 => Reservierungen sind erst
// ab `Date.now() + N Sekunden` erlaubt (Redis-Key `opensAt`, siehe
// packages/types/src/redis-keys.ts). 0/unset => Event ist sofort offen
// (bestehendes Default-Verhalten fuer normalen Dev-/Testbetrieb).
const SALE_OPENS_IN_SECONDS = Number(process.env.SALE_OPENS_IN_SECONDS ?? 0);
const opensAt =
  SALE_OPENS_IN_SECONDS > 0 ? Date.now() + SALE_OPENS_IN_SECONDS * 1000 : 0;

const pubsubBaseUrl = pubsubHost.startsWith("http://")
  ? pubsubHost
  : `http://${pubsubHost}`;

const quoteSql = (value) => `'${String(value).replace(/'/g, "''")}'`;

const runCommand = (command, env = {}) => {
  execSync(command, { env: { ...process.env, ...env }, stdio: "inherit" });
};

const checkContainers = () => {
  const output = execSync(
    `docker inspect -f '{{.State.Running}}' ${requiredContainers.join(" ")}`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
    .trim()
    .split("\n")
    .map((line) => line.trim().toLowerCase());

  const notRunning = requiredContainers.filter(
    (_, index) => output[index] !== "true",
  );

  if (notRunning.length > 0) {
    throw new Error(
      `Required containers are not running: ${notRunning.join(", ")}. Run 'docker compose up -d' first.`,
    );
  }
};

const resetPostgres = () => {
  console.log("[local:reset-seed] Applying DB schema via drizzle push...");
  runCommand("pnpm --filter @repo/db run db:push", {
    DATABASE_URL: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  });

  const eventValues = EVENT_FIXTURES.map(
    (event) =>
      `(${quoteSql(event.id)}, ${quoteSql(event.name)}, ${event.totalCapacity}, ${event.soldCount}, ${quoteSql(SEED_TIMESTAMP)})`,
  ).join(",\n");

  // const orderValues = ORDER_FIXTURES.map(
  //   (order) =>
  //     `(${quoteSql(order.id)}, ${quoteSql(order.eventId)}, ${quoteSql(order.status)}, ${quoteSql(SEED_TIMESTAMP)}, ${quoteSql(SEED_TIMESTAMP)})`,
  // ).join(",\n");

  // const ticketValues = TICKET_FIXTURES.map(
  //   (ticket) =>
  //     `(${quoteSql(ticket.id)}, ${quoteSql(ticket.eventId)}, ${quoteSql(ticket.orderId)}, ${quoteSql(ticket.firstName)}, ${quoteSql(ticket.lastName)}, ${quoteSql(ticket.status)}, ${quoteSql(SEED_TIMESTAMP)})`,
  // ).join(",\n");

  const sql = `
TRUNCATE TABLE tickets, orders, events RESTART IDENTITY CASCADE;

INSERT INTO events (id, name, total_capacity, sold_count, created_at)
VALUES
${eventValues};
`;
  //
  //
  // INSERT INTO orders (id, event_id, status, created_at, updated_at)
  // VALUES
  // ${orderValues};

  // INSERT INTO tickets (id, event_id, order_id, first_name, last_name, status, created_at)
  // VALUES
  // ${ticketValues};
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      POSTGRES_CONTAINER,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      POSTGRES_USER,
      "-d",
      POSTGRES_DB,
    ],
    {
      input: sql,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
};

const resetRedis = () => {
  console.log("[local:reset-seed] Resetting Redis cache keys...");

  execFileSync("docker", ["exec", REDIS_CONTAINER, "redis-cli", "FLUSHDB"], {
    stdio: "inherit",
  });

  const msetArgs = EVENT_FIXTURES.flatMap((event) => [
    `tickets:event:${event.id}:total`,
    String(event.totalCapacity),
    `tickets:event:${event.id}:available`,
    String(event.available),
    `tickets:event:${event.id}:opensAt`,
    String(opensAt),
  ]);

  execFileSync(
    "docker",
    ["exec", REDIS_CONTAINER, "redis-cli", "MSET", ...msetArgs],
    {
      stdio: "inherit",
    },
  );

  if (opensAt > 0) {
    console.log(
      `[local:reset-seed] Sale unlock gate active: opens at ${new Date(opensAt).toISOString()} (in ${SALE_OPENS_IN_SECONDS}s)`,
    );
  } else {
    console.log(
      "[local:reset-seed] Sale unlock gate inactive: events are open immediately.",
    );
  }
};

const pubSubRequest = async (method, path, expectedStatuses, body) => {
  const response = await fetch(`${pubsubBaseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!expectedStatuses.includes(response.status)) {
    const text = await response.text();
    throw new Error(
      `${method} ${path} failed with status ${response.status}: ${text}`,
    );
  }
};

const resetPubSub = async () => {
  console.log("[local:reset-seed] Resetting Pub/Sub emulator resources...");

  const topicPath = `/v1/projects/${projectId}/topics/${topicName}`;
  const subscriptionPath = `/v1/projects/${projectId}/subscriptions/${subscriptionName}`;

  await pubSubRequest("DELETE", subscriptionPath, [200, 404]);
  await pubSubRequest("DELETE", topicPath, [200, 404]);
  await pubSubRequest("PUT", topicPath, [200], {});
  await pubSubRequest("PUT", subscriptionPath, [200], {
    topic: `projects/${projectId}/topics/${topicName}`,
  });
};

const main = async () => {
  console.log("[local:reset-seed] Validating local infrastructure...");
  checkContainers();

  resetPostgres();
  resetRedis();
  await resetPubSub();

  console.log("[local:reset-seed] Completed successfully.");
  console.log(
    "[local:reset-seed] Seeded events:",
    EVENT_FIXTURES.map((event) => event.id).join(", "),
  );
  console.log(
    `[local:reset-seed] Active Pub/Sub subscription: ${subscriptionName}`,
  );
};

main().catch((error) => {
  console.error("[local:reset-seed] Failed.");
  if (error instanceof Error) {
    console.error(`[local:reset-seed] ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
