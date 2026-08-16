import { execFileSync, execSync } from "node:child_process";
import { requireEnv, requireEnvNumber } from "../lib/require-env.mjs";

const POSTGRES_CONTAINER = "hts-postgres";
const REDIS_CONTAINER = "hts-redis";
const PUBSUB_CONTAINER = "hts-pubsub";
const PROMETHEUS_CONTAINER = "hts-prometheus";
const POSTGRES_DB = "high_frequency_tickets";
const POSTGRES_USER = "postgres";

const SEED_TIMESTAMP = "2026-01-01T00:00:00Z";

// Kapazitaet des Haupt-Events — kommt aus dem Env-Profil, damit ein
// 100k-Funnel-Lauf und ein 1-M-Kapazitaetslauf sich nicht in der Shell-History
// unterscheiden, sondern in der Profil-Datei (ADR-034).
const SEED_CAPACITY = requireEnvNumber("SEED_CAPACITY");

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

const projectId = requireEnv("GOOGLE_CLOUD_PROJECT");
const topicName = requireEnv("PUBSUB_TOPIC_BUY_TICKET");
const subscriptionName = requireEnv("PUBSUB_SUBSCRIPTION_BUY_TICKET");
const pubsubHost = requireEnv("PUBSUB_EMULATOR_HOST");

// Sale-Unlock-Gate: > 0 => Reservierungen sind erst ab `Date.now() + N
// Sekunden` erlaubt (Redis-Key `opensAt`, siehe packages/types/src/redis-keys.ts),
// 0 => sofort offen. Frueher defaultete dieser Wert hier auf 0 und im
// Report-Orchestrator auf 60 — zwei Wahrheiten fuer dieselbe Variable.
const SALE_OPENS_IN_SECONDS = requireEnvNumber("SALE_OPENS_IN_SECONDS");
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
    DATABASE_URL: requireEnv("DATABASE_URL"),
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
  console.log(
    "[local:reset-seed] Ensuring Pub/Sub emulator resources (create-if-missing)...",
  );

  const topicPath = `/v1/projects/${projectId}/topics/${topicName}`;
  const subscriptionPath = `/v1/projects/${projectId}/subscriptions/${subscriptionName}`;

  // Idempotentes Provisioning: NICHT loeschen+neu-anlegen. Ein Delete wuerde die
  // Subscription unter einem bereits laufenden Worker wegziehen (sein
  // Streaming-Pull haengt danach an einer geloeschten Subscription → 0
  // persistierte Orders). `PUT` legt an, wenn die Ressource fehlt (200), und
  // liefert 409 ALREADY_EXISTS, wenn sie schon da ist — beides ist ok.
  await pubSubRequest("PUT", topicPath, [200, 409], {});
  await pubSubRequest("PUT", subscriptionPath, [200, 409], {
    topic: `projects/${projectId}/topics/${topicName}`,
  });
};

const isContainerRunning = (name) => {
  try {
    const state = execSync(`docker inspect -f '{{.State.Running}}' ${name}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .toLowerCase();
    return state === "true";
  } catch {
    return false;
  }
};

// Prometheus haelt bei hoher Label-Kardinalitaet (z.B. Series-Churn aus einem
// vorherigen Lasttest) einen aufgeblaehten Go-Heap resident, auch nachdem die
// Series wieder verschwunden sind. Ein frischer Seed-Lauf soll auch die Metrik-
// Historie leeren: Container stoppen (kein Prozess haelt dann die gemappten
// Chunk-/WAL-Dateien), TSDB-Volume via Wegwerf-Container leeren (--volumes-from
// koppelt uns nicht an den Compose-Volume-Namen) und frisch starten. Reclaimt
// RAM + Disk und vermeidet ein Replay des aufgeblaehten WAL. Nicht-fatal:
// Prometheus ist Monitoring, kein Seed-Kern-State.
const resetPrometheus = () => {
  if (process.env.SKIP_PROMETHEUS_RESET === "1") {
    console.log(
      "[local:reset-seed] Skipping Prometheus reset (SKIP_PROMETHEUS_RESET=1).",
    );
    return;
  }

  if (!isContainerRunning(PROMETHEUS_CONTAINER)) {
    console.log(
      `[local:reset-seed] ${PROMETHEUS_CONTAINER} not running; skipping Prometheus reset.`,
    );
    return;
  }

  console.log("[local:reset-seed] Wiping Prometheus TSDB (fresh metrics)...");
  try {
    execFileSync("docker", ["stop", PROMETHEUS_CONTAINER], { stdio: "inherit" });
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--volumes-from",
        PROMETHEUS_CONTAINER,
        "busybox",
        "sh",
        "-c",
        "cd /prometheus && rm -rf ./* ./.[!.]* 2>/dev/null; exit 0",
      ],
      { stdio: "inherit" },
    );
    execFileSync("docker", ["start", PROMETHEUS_CONTAINER], { stdio: "inherit" });
  } catch (error) {
    console.warn(
      `[local:reset-seed] Prometheus reset failed (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const main = async () => {
  console.log("[local:reset-seed] Validating local infrastructure...");
  checkContainers();

  resetPostgres();
  resetRedis();
  await resetPubSub();
  resetPrometheus();

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
