import { countWaitingLockBackends } from "@repo/db";
import fp from "fastify-plugin";
import { dbLocksWaiting } from "../lib/metrics.ts";

// Lock-wait is sampled on an interval rather than on scrape because it costs a
// query against pg_stat_activity. 5s matches the Prometheus scrape_interval, so
// every scrape sees a fresh sample without adding per-scrape DB load.
const DB_LOCK_SAMPLE_INTERVAL_MS = 5000;

/**
 * Periodically samples the number of backends waiting on a PostgreSQL lock into
 * the `db_locks_waiting` gauge. Pool state and query latency are recorded
 * elsewhere (scrape-time `collect` and the `timeDbQuery` wrapper); this plugin
 * owns only the sampled lock-contention signal and its timer lifecycle.
 */
export default fp(async (fastify) => {
  let sampleTimer: ReturnType<typeof setInterval> | undefined;

  const sampleLockWaits = async (): Promise<void> => {
    try {
      dbLocksWaiting.set(await countWaitingLockBackends());
    } catch (err: unknown) {
      fastify.log.debug({ err }, "Failed to sample PostgreSQL lock waits");
    }
  };

  fastify.addHook("onReady", async () => {
    await sampleLockWaits();
    sampleTimer = setInterval(() => {
      void sampleLockWaits();
    }, DB_LOCK_SAMPLE_INTERVAL_MS);
    // Do not keep the worker process alive solely for the metrics sampler.
    sampleTimer.unref();
  });

  fastify.addHook("onClose", async () => {
    if (sampleTimer !== undefined) {
      clearInterval(sampleTimer);
    }
  });
});
