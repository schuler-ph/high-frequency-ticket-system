import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { config } from "dotenv";

config({ path: ["../../.env"] });

const allowedNodeEnvs = new Set(["development", "test", "production"]);
const allowedLogLevels = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
]);

const testRuntimeDefaults = {
  NODE_ENV: "test",
  LOG_LEVEL: "warn",
  REDIS_URL: "redis://localhost:6379",
  DATABASE_URL:
    "postgres://postgres:postgres@localhost:5432/high_frequency_tickets",
  GOOGLE_CLOUD_PROJECT: "high-frequency-ticket-system",
  PUBSUB_EMULATOR_HOST: "localhost:8085",
  PUBSUB_TOPIC_BUY_TICKET: "buy-ticket",
  PUBSUB_SUBSCRIPTION_BUY_TICKET: "buy-ticket-worker",
} as const;

const isNodeTestRuntime =
  process.env.NODE_ENV === "test" || process.execArgv.includes("--test");

const createRuntimeEnv = (runtimeEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  if (!isNodeTestRuntime) {
    return runtimeEnv;
  }

  return {
    ...runtimeEnv,
    NODE_ENV: allowedNodeEnvs.has(runtimeEnv.NODE_ENV ?? "")
      ? runtimeEnv.NODE_ENV
      : testRuntimeDefaults.NODE_ENV,
    LOG_LEVEL: allowedLogLevels.has(runtimeEnv.LOG_LEVEL ?? "")
      ? runtimeEnv.LOG_LEVEL
      : testRuntimeDefaults.LOG_LEVEL,
    REDIS_URL: runtimeEnv.REDIS_URL ?? testRuntimeDefaults.REDIS_URL,
    DATABASE_URL: runtimeEnv.DATABASE_URL ?? testRuntimeDefaults.DATABASE_URL,
    GOOGLE_CLOUD_PROJECT:
      runtimeEnv.GOOGLE_CLOUD_PROJECT ??
      testRuntimeDefaults.GOOGLE_CLOUD_PROJECT,
    PUBSUB_EMULATOR_HOST:
      runtimeEnv.PUBSUB_EMULATOR_HOST ??
      testRuntimeDefaults.PUBSUB_EMULATOR_HOST,
    PUBSUB_TOPIC_BUY_TICKET:
      runtimeEnv.PUBSUB_TOPIC_BUY_TICKET ??
      testRuntimeDefaults.PUBSUB_TOPIC_BUY_TICKET,
    PUBSUB_SUBSCRIPTION_BUY_TICKET:
      runtimeEnv.PUBSUB_SUBSCRIPTION_BUY_TICKET ??
      testRuntimeDefaults.PUBSUB_SUBSCRIPTION_BUY_TICKET,
  };
};

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
    REDIS_URL: z.url(),
    DATABASE_URL: z.url(),
    GOOGLE_CLOUD_PROJECT: z.string().min(1),
    PUBSUB_EMULATOR_HOST: z.string().min(1),
    PUBSUB_TOPIC_BUY_TICKET: z.string().min(1),
    PUBSUB_SUBSCRIPTION_BUY_TICKET: z.string().min(1),
    REDIS_RESERVATION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(120),
    REDIS_WORKER_PROCESSING_LOCK_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60),
    REDIS_WORKER_PROCESSED_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(86400),
  },

  /**
   * The prefix that client-side variables must have. This is enforced both at
   * a type-level and at runtime.
   */
  clientPrefix: "PUBLIC_",

  client: {},

  /**
   * What object holds the environment variables at runtime. This is usually
   * `process.env` or `import.meta.env`.
   */
  runtimeEnv: createRuntimeEnv(process.env),

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   */
  emptyStringAsUndefined: true,
});
