import { env } from "@repo/env";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

// Expliziter Pool statt Default (10 Connections): Groesse ist auf die
// Pub/Sub-Flow-Control des Workers abgestimmt (PUBSUB_FLOW_CONTROL_MAX_MESSAGES).
// Exportiert, damit der Worker Pool-Saettigung (`totalCount`/`idleCount`/
// `waitingCount`) als Prometheus-Gauge beobachten kann (ADR-026).
//
// `connectionTimeoutMillis` begrenzt das Warten auf eine freie Connection. Der
// Pool ist der harte Begrenzer des Schreibpfads — die Flow-Control ist mit
// `allowExcessMessages` eine weiche Grenze —, und ohne Timeout wartet ein
// Acquirer unbegrenzt. Ein Timeout macht Saettigung zu einem typisierten,
// transienten Fehler (NACK, Redelivery) statt zu unbegrenzter Latenz.
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  connectionTimeoutMillis: env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
});

export const db = drizzle(pool, { schema });

export * from "./schema.ts";
export * from "./order-processing.ts";
