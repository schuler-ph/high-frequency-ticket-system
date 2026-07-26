/**
 * Run-manifest construction and configuration redaction (pure).
 *
 * Every report begins with a manifest (automation doc, "Run manifest"). Secrets
 * such as DATABASE_URL, passwords, tokens, or a full process environment must
 * NEVER be written into artifacts; only an explicit allowlist of non-sensitive
 * settings is captured.
 */

export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * Non-sensitive configuration keys that are safe to persist into artifacts.
 * Anything not on this list is dropped by {@link redactConfig}.
 */
export const CONFIG_ALLOWLIST = [
  "NODE_ENV",
  "LOG_LEVEL",
  "DISABLE_REQUEST_LOGGING",
  "PUBSUB_FLOW_CONTROL_MAX_MESSAGES",
  "DATABASE_POOL_MAX",
  "RESERVATION_STALE_SECONDS",
  "REDIS_PENDING_ORDER_TTL_SECONDS",
  "REDIS_FINAL_ORDER_TTL_SECONDS",
  "REDIS_WORKER_PROCESSED_TTL_SECONDS",
  "WORKER_RECONCILE_MODE",
  "WORKER_RECONCILE_INTERVAL_PEAK_SECONDS",
  "WORKER_RECONCILE_INTERVAL_NORMAL_SECONDS",
  "LOAD_PROFILE",
  "PAY_RATE",
  "CANCEL_RATE",
  "THINK_TIME_MIN",
  "THINK_TIME_MAX",
  "SEED_CAPACITY",
  "SALE_OPENS_IN_SECONDS",
];

/**
 * Keep only the allowlisted, non-sensitive settings from an environment-like
 * object. Undefined values are omitted so the manifest records only what was
 * actually set.
 *
 * @param {Record<string, string | undefined>} source
 * @returns {Record<string, string>}
 */
export const redactConfig = (source) => {
  const out = {};
  for (const key of CONFIG_ALLOWLIST) {
    const value = source?.[key];
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
};

/**
 * Assemble a manifest object. All inputs are provided by the caller (the
 * orchestrator resolves git/host/timestamps via side effects); this function
 * only shapes and defaults them so it stays pure and testable.
 *
 * @param {{
 *   runId: string,
 *   git?: { commit: string, branch: string, dirty: boolean },
 *   host?: { platform: string, arch: string, cpuCount: number, memoryBytes: number },
 *   profile?: object,
 *   configuration?: Record<string, string>,
 *   capacity?: { totalCapacity: number | null, opensAt: number | null },
 *   timestamps?: Record<string, string | null>,
 * }} input
 * @returns {object}
 */
export const buildManifest = (input) => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  runId: input.runId,
  git: input.git ?? { commit: "unknown", branch: "unknown", dirty: false },
  host: input.host ?? {
    platform: "unknown",
    arch: "unknown",
    cpuCount: 0,
    memoryBytes: 0,
  },
  profile: input.profile ?? {},
  configuration: input.configuration ?? {},
  capacity: input.capacity ?? { totalCapacity: null, opensAt: null },
  timestamps: {
    seededAt: null,
    workloadStartedAt: null,
    phaseAEndedAt: null,
    workloadEndedAt: null,
    drainEndedAt: null,
    ...(input.timestamps ?? {}),
  },
});
