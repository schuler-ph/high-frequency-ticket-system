import { execFileSync, execSync } from "node:child_process";

const POSTGRES_CONTAINER = "hts-postgres";
const REDIS_CONTAINER = "hts-redis";
const PUBSUB_CONTAINER = "hts-pubsub";
const POSTGRES_DB = "high_frequency_tickets";
const POSTGRES_USER = "postgres";

const DEFAULT_PROJECT_ID = "high-frequency-ticket-system";
const DEFAULT_PUBSUB_TOPIC = "buy-ticket";
const DEFAULT_PUBSUB_SUBSCRIPTION = "buy-ticket-worker";
const DEFAULT_PUBSUB_HOST = "localhost:8085";
const SEED_TIMESTAMP = "2026-01-01T00:00:00Z";

const EVENT_FIXTURES = [
  {
    id: "00000000-0000-4000-8000-000000000000",
    name: "Frequency Festival 20XX Main Sale",
    totalCapacity: 1_000_000,
    soldCount: 0,
    available: 1_000_000,
  },
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Frequency Festival 20XX Warmup",
    totalCapacity: 5_000,
    soldCount: 1,
    available: 4_999,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Frequency Festival 20XX Sold Out Demo",
    totalCapacity: 100,
    soldCount: 100,
    available: 0,
  },
];

const ORDER_FIXTURES = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    eventId: "00000000-0000-4000-8000-000000000000",
    status: "pending",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    eventId: "00000000-0000-4000-8000-000000000001",
    status: "completed",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    eventId: "00000000-0000-4000-8000-000000000002",
    status: "failed",
  },
];

const TICKET_FIXTURES = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    eventId: "00000000-0000-4000-8000-000000000001",
    orderId: "22222222-2222-4222-8222-222222222222",
    firstName: "Seed",
    lastName: "Buyer",
    status: "valid",
  },
];

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

const pubsubBaseUrl = pubsubHost.startsWith("http://")
  ? pubsubHost
  : `http://${pubsubHost}`;

const quoteSql = (value) => `'${String(value).replace(/'/g, "''")}'`;

const runCommand = (command) => {
  execSync(command, { stdio: "inherit" });
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
  runCommand("pnpm --filter @repo/db run db:push");

  const eventValues = EVENT_FIXTURES.map(
    (event) =>
      `(${quoteSql(event.id)}, ${quoteSql(event.name)}, ${event.totalCapacity}, ${event.soldCount}, ${quoteSql(SEED_TIMESTAMP)})`,
  ).join(",\n");

  const orderValues = ORDER_FIXTURES.map(
    (order) =>
      `(${quoteSql(order.id)}, ${quoteSql(order.eventId)}, ${quoteSql(order.status)}, ${quoteSql(SEED_TIMESTAMP)}, ${quoteSql(SEED_TIMESTAMP)})`,
  ).join(",\n");

  const ticketValues = TICKET_FIXTURES.map(
    (ticket) =>
      `(${quoteSql(ticket.id)}, ${quoteSql(ticket.eventId)}, ${quoteSql(ticket.orderId)}, ${quoteSql(ticket.firstName)}, ${quoteSql(ticket.lastName)}, ${quoteSql(ticket.status)}, ${quoteSql(SEED_TIMESTAMP)})`,
  ).join(",\n");

  const sql = `
TRUNCATE TABLE tickets, orders, events RESTART IDENTITY CASCADE;

INSERT INTO events (id, name, total_capacity, sold_count, created_at)
VALUES
${eventValues};

INSERT INTO orders (id, event_id, status, created_at, updated_at)
VALUES
${orderValues};

INSERT INTO tickets (id, event_id, order_id, first_name, last_name, status, created_at)
VALUES
${ticketValues};
`;

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
  ]);

  execFileSync(
    "docker",
    ["exec", REDIS_CONTAINER, "redis-cli", "MSET", ...msetArgs],
    {
      stdio: "inherit",
    },
  );
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
