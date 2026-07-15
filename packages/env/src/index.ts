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
    // Max. gleichzeitig zugestellte Pub/Sub-Nachrichten pro Worker-Instanz.
    // Mit dem 1-s-Payment-Mock entspricht das ~N Kaeufen/s pro Worker.
    PUBSUB_FLOW_CONTROL_MAX_MESSAGES: z.coerce
      .number()
      .int()
      .positive()
      .default(500),
    // Max. PostgreSQL-Connections pro Prozess (node-postgres Pool).
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
    // Startup-Fail-Fast: obere Schranke, wie lange API/Worker beim Boot auf
    // eine erreichbare Infrastruktur warten, bevor sie mit einer klaren,
    // umsetzbaren Fehlermeldung abbrechen (statt eines opaquen Plugin-Timeouts).
    // Bewusst unter dem Fastify/avvio-Default (10 s) gehalten.
    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    PUBSUB_STARTUP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    // Alter (Sekunden), ab dem ein noch offener Ledger-Eintrag als
    // Stale-Kandidat fuer den Reaper (Phase 6) gilt. Reine Observability:
    // Reservierungen laufen NICHT mehr per TTL ab (ADR-026), sie bleiben ein
    // Inventar-Anspruch bis Finalisierung/Kompensation. Grosszuegig ueber der
    // erwarteten Queue-Latenz (Baseline A: ~406 s) angesetzt.
    RESERVATION_STALE_SECONDS: z.coerce.number().int().positive().default(900),
    REDIS_PENDING_ORDER_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    REDIS_FINAL_ORDER_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(86400),
    REDIS_WORKER_PROCESSED_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(86400),
    WORKER_RECONCILE_MODE: z.enum(["peak", "normal"]).default("normal"),
    WORKER_RECONCILE_INTERVAL_PEAK_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    WORKER_RECONCILE_INTERVAL_NORMAL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60),
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
