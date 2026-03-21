import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { config } from "dotenv";

config({ path: ["../../.env"] });

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
  runtimeEnv: process.env,

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   */
  emptyStringAsUndefined: true,
});
