import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { requireEnv, requireEnvNumber } from "../lib/require-env.mjs";

/**
 * Fokussierter Hot-Row-Mikro-Benchmark (Stage 2 / Backlog #7).
 *
 * Publiziert N `BuyTicketEvent`s DIREKT an den Pub/Sub-Emulator (umgeht die API,
 * kein Reserve/Pay-Split noetig) und misst, wie schnell der Worker sie via
 * `buy_ticket` persistiert. Isoliert damit den `sold_count`-Hot-Row-`UPDATE` als
 * Limiter: bei einem Event serialisieren alle parallelen Worker-Transaktionen
 * auf derselben `events`-Row.
 *
 * Gemessen wird rein aus PostgreSQL (keine App-Instrumentierung noetig):
 *   - Durchsatz: persistierte Tickets / Sekunde (Drain-Wallclock).
 *   - Hot-Row-Kontention: Peak paralleler Backends mit `wait_event_type='Lock'`
 *     aus `pg_stat_activity` (periodisches Sampling waehrend des Drains).
 * Optional (best-effort) scraped das Skript den Worker-`/metrics`-Endpunkt fuer
 * `db_query_duration_seconds{query="buy_ticket"}` und `db_locks_waiting`.
 *
 * Voraussetzung: Infra-Container laufen und ein Worker konsumiert mit erhoehter
 * Flow-Control (`PUBSUB_FLOW_CONTROL_MAX_MESSAGES > 1000`). Siehe
 * `docs/reports/hot-row-bench/README.md` fuer den Ablauf.
 */

const POSTGRES_CONTAINER = "hts-postgres";
const POSTGRES_DB = "high_frequency_tickets";
const POSTGRES_USER = "postgres";

// Alle Werte kommen aus dem `bench`-Profil (config/env/bench.env, ADR-034).
const projectId = requireEnv("GOOGLE_CLOUD_PROJECT");
const topicName = requireEnv("PUBSUB_TOPIC_BUY_TICKET");
const pubsubHost = requireEnv("PUBSUB_EMULATOR_HOST");
const eventId = requireEnv("BENCH_EVENT_ID");
const workerMetricsUrl = requireEnv("BENCH_WORKER_METRICS_URL");

const messageCount = requireEnvNumber("BENCH_MESSAGES");
const publishBatchSize = requireEnvNumber("BENCH_PUBLISH_BATCH");
const sampleIntervalMs = requireEnvNumber("BENCH_SAMPLE_INTERVAL_MS");
const drainTimeoutMs = requireEnvNumber("BENCH_DRAIN_TIMEOUT_MS");

if (!Number.isInteger(messageCount) || messageCount <= 0) {
  throw new Error(
    `BENCH_MESSAGES must be a positive integer, got ${messageCount}`,
  );
}

const pubsubBaseUrl = pubsubHost.startsWith("http://")
  ? pubsubHost
  : `http://${pubsubHost}`;
const publishUrl = `${pubsubBaseUrl}/v1/projects/${projectId}/topics/${topicName}:publish`;

const log = (message) => console.log(`[bench:hot-row] ${message}`);

const psql = (sql) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      POSTGRES_CONTAINER,
      "psql",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      POSTGRES_USER,
      "-d",
      POSTGRES_DB,
    ],
    { input: sql, encoding: "utf8" },
  ).trim();

const ticketCount = () =>
  Number(psql(`SELECT count(*) FROM tickets WHERE event_id = '${eventId}';`));

const soldCount = () =>
  Number(psql(`SELECT sold_count FROM events WHERE id = '${eventId}';`));

/** Backends, die aktuell auf einen Lock warten (Hot-Row-Kontentions-Signal). */
const lockWaitBackends = () =>
  Number(
    psql(
      `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';`,
    ),
  );

const buildMessage = () => {
  const payload = {
    eventId,
    orderId: randomUUID(),
    firstName: "Bench",
    lastName: "Buyer",
    queuedAt: Date.now(),
  };
  return { data: Buffer.from(JSON.stringify(payload)).toString("base64") };
};

const publishBatch = async (messages) => {
  const response = await fetch(publishUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Publish failed (${response.status}): ${text}`);
  }
};

const publishAll = async () => {
  log(
    `Publishing ${messageCount} messages in batches of ${publishBatchSize}...`,
  );
  const startedAt = Date.now();
  let published = 0;
  while (published < messageCount) {
    const size = Math.min(publishBatchSize, messageCount - published);
    const messages = Array.from({ length: size }, buildMessage);
    await publishBatch(messages);
    published += size;
  }
  const seconds = (Date.now() - startedAt) / 1000;
  log(`Published ${published} messages in ${seconds.toFixed(1)}s.`);
};

/** Best-effort Prometheus-Scrape des Worker-`/metrics`. */
const scrapeWorkerMetrics = async () => {
  try {
    const response = await fetch(workerMetricsUrl);
    if (!response.ok) return null;
    const text = await response.text();
    return parseBuyTicketMetrics(text);
  } catch {
    return null;
  }
};

const parseBuyTicketMetrics = (text) => {
  const lines = text.split("\n");
  const buckets = [];
  let sum = null;
  let count = null;
  let locksWaiting = null;
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (
      line.includes("db_query_duration_seconds_bucket") &&
      line.includes('query="buy_ticket"')
    ) {
      const le = /le="([^"]+)"/.exec(line)?.[1];
      const value = Number(line.trim().split(/\s+/).pop());
      if (le !== undefined) buckets.push({ le, value });
    } else if (
      line.includes("db_query_duration_seconds_sum") &&
      line.includes('query="buy_ticket"')
    ) {
      sum = Number(line.trim().split(/\s+/).pop());
    } else if (
      line.includes("db_query_duration_seconds_count") &&
      line.includes('query="buy_ticket"')
    ) {
      count = Number(line.trim().split(/\s+/).pop());
    } else if (line.startsWith("db_locks_waiting")) {
      locksWaiting = Number(line.trim().split(/\s+/).pop());
    }
  }
  const avgMs = sum !== null && count ? (sum / count) * 1000 : null;
  return {
    avgBuyTicketMs: avgMs,
    buyTicketSamples: count,
    locksWaiting,
    buckets,
  };
};

const main = async () => {
  log(`Config: messages=${messageCount}, event=${eventId}, topic=${topicName}`);
  const startTickets = ticketCount();
  const startSold = soldCount();
  log(`Start state: tickets=${startTickets}, events.sold_count=${startSold}`);

  const target = startTickets + messageCount;

  await publishAll();

  log("Draining — sampling lock-wait backends until all tickets persisted...");
  const drainStartedAt = Date.now();
  let peakLockWaits = 0;
  const lockWaitSamples = [];
  let current = startTickets;

  while (current < target) {
    if (Date.now() - drainStartedAt > drainTimeoutMs) {
      log(
        `Drain timeout after ${drainTimeoutMs}ms at ${current}/${target} tickets.`,
      );
      break;
    }
    const waits = lockWaitBackends();
    lockWaitSamples.push(waits);
    if (waits > peakLockWaits) peakLockWaits = waits;
    await delay(sampleIntervalMs);
    current = ticketCount();
  }

  const drainSeconds = (Date.now() - drainStartedAt) / 1000;
  const persisted = current - startTickets;
  const throughput = persisted / drainSeconds;
  const avgLockWaits =
    lockWaitSamples.length > 0
      ? lockWaitSamples.reduce((a, b) => a + b, 0) / lockWaitSamples.length
      : 0;

  const metrics = await scrapeWorkerMetrics();
  const endSold = soldCount();

  log("──────────────────────────────────────────────");
  log(`Persisted tickets:        ${persisted}`);
  log(`Drain wallclock:          ${drainSeconds.toFixed(2)}s`);
  log(`Throughput:               ${throughput.toFixed(0)} tickets/s`);
  log(`Peak lock-wait backends:  ${peakLockWaits}`);
  log(`Avg lock-wait backends:   ${avgLockWaits.toFixed(2)}`);
  log(`events.sold_count (end):  ${endSold}`);
  if (metrics) {
    log(
      `buy_ticket avg duration:  ${metrics.avgBuyTicketMs?.toFixed(2) ?? "n/a"} ms (${metrics.buyTicketSamples ?? 0} samples)`,
    );
    log(`db_locks_waiting (gauge): ${metrics.locksWaiting ?? "n/a"}`);
  } else {
    log(
      `worker /metrics:          unreachable at ${workerMetricsUrl} (skipped)`,
    );
  }
  log("──────────────────────────────────────────────");

  const summary = {
    config: { messageCount, eventId, topicName, sampleIntervalMs },
    persisted,
    drainSeconds: Number(drainSeconds.toFixed(2)),
    throughputPerSecond: Number(throughput.toFixed(0)),
    peakLockWaitBackends: peakLockWaits,
    avgLockWaitBackends: Number(avgLockWaits.toFixed(2)),
    eventsSoldCountEnd: endSold,
    workerMetrics: metrics,
  };
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error("[bench:hot-row] Failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
