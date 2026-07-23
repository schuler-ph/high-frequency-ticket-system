/**
 * Authoritative PostgreSQL / Redis state snapshots via the local container
 * CLIs (same access path as scripts/local/reset-seed.mjs). These are the
 * side-effecting collectors the orchestrator calls before and after the run;
 * the pure analyzer consumes their JSON output.
 *
 * Read-only: SELECTs and Redis read commands only. `SCAN`/`ZCARD` here is a
 * one-off post-run diagnostic, not a runtime accounting path.
 */

import { execFileSync } from "node:child_process";

const POSTGRES_CONTAINER = "hts-postgres";
const REDIS_CONTAINER = "hts-redis";
const POSTGRES_DB = "high_frequency_tickets";
const POSTGRES_USER = "postgres";

/** Run a single-value SQL query and return the trimmed scalar (or null). */
const psqlScalar = (sql) => {
  const out = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      POSTGRES_CONTAINER,
      "psql",
      "-tAX",
      "-U",
      POSTGRES_USER,
      "-d",
      POSTGRES_DB,
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  ).trim();
  return out === "" ? null : out;
};

const toNumber = (value) => (value === null ? null : Number(value));

/**
 * @param {string} eventId
 * @returns {{ capacity: number|null, soldCount: number|null, orders: number|null, tickets: number|null, pendingOrders: number|null, dbSizeBytes: number|null }}
 */
export const snapshotPostgres = (eventId) => {
  const safeEventId = eventId.replace(/'/g, "''");
  return {
    capacity: toNumber(
      psqlScalar(
        `SELECT total_capacity FROM events WHERE id = '${safeEventId}'`,
      ),
    ),
    soldCount: toNumber(
      psqlScalar(`SELECT sold_count FROM events WHERE id = '${safeEventId}'`),
    ),
    orders: toNumber(psqlScalar("SELECT count(*) FROM orders")),
    tickets: toNumber(psqlScalar("SELECT count(*) FROM tickets")),
    pendingOrders: toNumber(
      psqlScalar("SELECT count(*) FROM orders WHERE status = 'pending'"),
    ),
    dbSizeBytes: toNumber(
      psqlScalar(`SELECT pg_database_size('${POSTGRES_DB}')`),
    ),
  };
};

/** Run a redis-cli command and return its trimmed stdout. */
const redis = (...args) =>
  execFileSync("docker", ["exec", REDIS_CONTAINER, "redis-cli", ...args], {
    encoding: "utf8",
  }).trim();

const infoField = (info, field) => {
  const match = info.match(new RegExp(`^${field}:(.*)$`, "m"));
  return match ? match[1].trim() : null;
};

/**
 * @param {string} eventId
 * @returns {{ total: number|null, available: number|null, activeReservations: number|null, dbSize: number|null, usedMemoryBytes: number|null }}
 */
export const snapshotRedis = (eventId) => {
  const total = redis("GET", `tickets:event:${eventId}:total`);
  const available = redis("GET", `tickets:event:${eventId}:available`);
  const activeReservations = redis(
    "ZCARD",
    `tickets:event:${eventId}:reservations`,
  );
  const dbSize = redis("DBSIZE");
  const memInfo = redis("INFO", "memory");

  return {
    total: total === "" ? null : Number(total),
    available: available === "" ? null : Number(available),
    activeReservations:
      activeReservations === "" ? null : Number(activeReservations),
    dbSize: dbSize === "" ? null : Number(dbSize),
    usedMemoryBytes: toNumber(infoField(memInfo, "used_memory")),
  };
};
