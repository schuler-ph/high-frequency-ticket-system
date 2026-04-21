import { env } from "@repo/env";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

export const db = drizzle(env.DATABASE_URL, { schema });

export * from "./schema.ts";
export * from "./order-processing.ts";
