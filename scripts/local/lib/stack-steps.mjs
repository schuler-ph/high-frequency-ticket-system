import { execFileSync, execSync } from "node:child_process";
import { requireEnv, requireEnvNumber } from "../../lib/require-env.mjs";

/**
 * Die einzelnen Schritte des lokalen Stack-Setups, getrennt nach ihrem
 * Zeitpunkt.
 *
 * **Provisionierung** (`applySchema`, `provisionPubSub`) ist idempotent und
 * muss VOR den Services laufen: der Worker scheitert beim Boot hart, wenn die
 * Pub/Sub-Subscription fehlt.
 *
 * **Reset** (`resetDatabaseState`, `resetRedis`, `purgeSubscription`,
 * `resetPrometheus`) ist destruktiv und muss UNMITTELBAR VOR der Last laufen —
 * vor allem wegen `opensAt`: das Sale-Unlock-Gate wird als `Date.now() + N`
 * gesetzt und verfaellt, wenn zwischen Reset und Lastbeginn Minuten vergehen.
 *
 * Vorher lag beides in einem Skript, weshalb der Lasttest-Stack und der
 * Report-Lauf es beide aufrufen mussten, um beide Zeitpunkte zu treffen.
 */

const POSTGRES_CONTAINER = "hts-postgres";
const REDIS_CONTAINER = "hts-redis";
const PUBSUB_CONTAINER = "hts-pubsub";
const PROMETHEUS_CONTAINER = "hts-prometheus";
const POSTGRES_DB = "high_frequency_tickets";
const POSTGRES_USER = "postgres";

const SEED_TIMESTAMP = "2026-01-01T00:00:00Z";

const requiredContainers = [
  POSTGRES_CONTAINER,
  REDIS_CONTAINER,
  PUBSUB_CONTAINER,
];

const quoteSql = (value) => `'${String(value).replace(/'/g, "''")}'`;

const pubsubBaseUrl = () => {
  const host = requireEnv("PUBSUB_EMULATOR_HOST");
  return host.startsWith("http://") ? host : `http://${host}`;
};

/**
 * Event-Fixtures. Bewusst eine Funktion und keine Konstante: die Kapazitaet
 * kommt aus dem Env-Profil, und nur der Reset-Pfad braucht sie — die
 * Provisionierung soll nicht daran scheitern.
 */
export const eventFixtures = () => {
  const capacity = requireEnvNumber("SEED_CAPACITY");
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(
      `SEED_CAPACITY must be a positive integer, got ${JSON.stringify(process.env.SEED_CAPACITY)}`,
    );
  }
  return [
    {
      id: "00000000-0000-4000-8000-000000000000",
      name: "Frequency Festival 20XX Main Sale",
      totalCapacity: capacity,
      soldCount: 0,
      available: capacity,
    },
  ];
};

export const checkContainers = () => {
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

// --- Provisionierung -------------------------------------------------------

export const applySchema = (log) => {
  log("Applying DB schema via drizzle push...");
  execSync("pnpm --filter @repo/db run db:push", {
    env: { ...process.env, DATABASE_URL: requireEnv("DATABASE_URL") },
    stdio: "inherit",
  });
};

const pubSubRequest = async (method, path, expectedStatuses, body) => {
  const response = await fetch(`${pubsubBaseUrl()}${path}`, {
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
  return response.status;
};

export const provisionPubSub = async (log) => {
  const projectId = requireEnv("GOOGLE_CLOUD_PROJECT");
  const topicName = requireEnv("PUBSUB_TOPIC_BUY_TICKET");
  const subscriptionName = requireEnv("PUBSUB_SUBSCRIPTION_BUY_TICKET");

  log("Ensuring Pub/Sub emulator resources (create-if-missing)...");

  // Idempotentes Provisioning: NICHT loeschen+neu-anlegen. Ein Delete wuerde die
  // Subscription unter einem bereits laufenden Worker wegziehen (sein
  // Streaming-Pull haengt danach an einer geloeschten Subscription → 0
  // persistierte Orders). `PUT` legt an, wenn die Ressource fehlt (200), und
  // liefert 409 ALREADY_EXISTS, wenn sie schon da ist — beides ist ok.
  await pubSubRequest("PUT", `/v1/projects/${projectId}/topics/${topicName}`, [
    200, 409,
  ]);
  await pubSubRequest(
    "PUT",
    `/v1/projects/${projectId}/subscriptions/${subscriptionName}`,
    [200, 409],
    { topic: `projects/${projectId}/topics/${topicName}` },
  );

  return subscriptionName;
};

// --- Reset -----------------------------------------------------------------

export const resetDatabaseState = (log) => {
  const events = eventFixtures();
  log("Truncating orders/tickets and reinserting event fixtures...");

  const eventValues = events
    .map(
      (event) =>
        `(${quoteSql(event.id)}, ${quoteSql(event.name)}, ${event.totalCapacity}, ${event.soldCount}, ${quoteSql(SEED_TIMESTAMP)})`,
    )
    .join(",\n");

  const sql = `
TRUNCATE TABLE tickets, orders, events RESTART IDENTITY CASCADE;

INSERT INTO events (id, name, total_capacity, sold_count, created_at)
VALUES
${eventValues};
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
    { input: sql, stdio: ["pipe", "inherit", "inherit"] },
  );

  return events;
};

export const resetRedis = (log) => {
  const events = eventFixtures();
  const saleOpensInSeconds = requireEnvNumber("SALE_OPENS_IN_SECONDS");
  // Hier und nicht beim Modul-Import: das Gate zaehlt ab DIESEM Moment.
  const opensAt =
    saleOpensInSeconds > 0 ? Date.now() + saleOpensInSeconds * 1000 : 0;

  log("Resetting Redis cache keys...");

  execFileSync("docker", ["exec", REDIS_CONTAINER, "redis-cli", "FLUSHDB"], {
    stdio: "inherit",
  });

  const msetArgs = events.flatMap((event) => [
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
    { stdio: "inherit" },
  );

  if (opensAt > 0) {
    log(
      `Sale unlock gate active: opens at ${new Date(opensAt).toISOString()} (in ${saleOpensInSeconds}s)`,
    );
  } else {
    log("Sale unlock gate inactive: events are open immediately.");
  }

  return opensAt;
};

/**
 * Bestaetigt alle bereits vorhandenen Nachrichten der Subscription.
 *
 * Ohne diesen Schritt ueberleben unbestaetigte Nachrichten eines abgebrochenen
 * Laufs den Reset. Nach dem `TRUNCATE` kennt die Datenbank ihre `orderId`s
 * nicht mehr, der Worker persistiert sie also als neue Verkaeufe — ohne
 * zugehoerige Reservierung. Das Ergebnis waere ein Capacity-Delta und ein
 * `system=fail`, ohne dass am System etwas falsch waere.
 *
 * `seek` auf „jetzt" ist dafuer das richtige Werkzeug: es bestaetigt den
 * Rueckstand, ohne die Subscription zu loeschen (was einen laufenden Worker
 * abhaengen wuerde).
 */
export const purgeSubscription = async (log) => {
  const projectId = requireEnv("GOOGLE_CLOUD_PROJECT");
  const subscriptionName = requireEnv("PUBSUB_SUBSCRIPTION_BUY_TICKET");

  log("Purging Pub/Sub backlog (seek to now)...");

  const status = await pubSubRequest(
    "POST",
    `/v1/projects/${projectId}/subscriptions/${subscriptionName}:seek`,
    // 404: noch nie provisioniert — dann gibt es auch keinen Rueckstand.
    [200, 404],
    { time: new Date().toISOString() },
  );

  if (status === 404) {
    log(
      `Subscription ${subscriptionName} does not exist yet; nothing to purge.`,
    );
  }
};

// Prometheus haelt bei hoher Label-Kardinalitaet (z.B. Series-Churn aus einem
// vorherigen Lasttest) einen aufgeblaehten Go-Heap resident, auch nachdem die
// Series wieder verschwunden sind. Ein frischer Lauf soll auch die Metrik-
// Historie leeren: Container stoppen (kein Prozess haelt dann die gemappten
// Chunk-/WAL-Dateien), TSDB-Volume via Wegwerf-Container leeren
// (--volumes-from koppelt uns nicht an den Compose-Volume-Namen) und frisch
// starten. Reclaimt RAM + Disk und vermeidet ein Replay des aufgeblaehten WAL.
// Nicht-fatal: Prometheus ist Monitoring, kein Kern-State.
export const resetPrometheus = (log) => {
  if (process.env.SKIP_PROMETHEUS_RESET === "1") {
    log("Skipping Prometheus reset (SKIP_PROMETHEUS_RESET=1).");
    return;
  }

  if (!isContainerRunning(PROMETHEUS_CONTAINER)) {
    log(`${PROMETHEUS_CONTAINER} not running; skipping Prometheus reset.`);
    return;
  }

  log("Wiping Prometheus TSDB (fresh metrics)...");
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
    execFileSync("docker", ["start", PROMETHEUS_CONTAINER], {
      stdio: "inherit",
    });
  } catch (error) {
    log(
      `Prometheus reset failed (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

/** Einheitlicher Fehler-Exit fuer die Einstiegspunkte. */
export const runEntrypoint = (label, fn) => {
  fn().catch((error) => {
    console.error(`[${label}] Failed.`);
    console.error(
      `[${label}] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
};
