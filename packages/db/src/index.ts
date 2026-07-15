import { env } from "@repo/env";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

// Expliziter Pool statt Default (10 Connections): Groesse ist auf die
// Pub/Sub-Flow-Control des Workers abgestimmt (PUBSUB_FLOW_CONTROL_MAX_MESSAGES).
// Exportiert, damit der Worker Pool-Saettigung (`totalCount`/`idleCount`/
// `waitingCount`) als Prometheus-Gauge beobachten kann (ADR-026).
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
});

export const db = drizzle(pool, { schema });

export * from "./schema.ts";
export * from "./order-processing.ts";
