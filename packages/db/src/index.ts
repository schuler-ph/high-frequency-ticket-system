import { env } from "@repo/env";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export const db = drizzle(env.DATABASE_URL, { schema });

export * from "./schema.js";
