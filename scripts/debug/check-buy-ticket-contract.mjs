import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const fail = (message) => {
  console.error(`[debug:buy-ticket-contract] ${message}`);
  process.exit(1);
};

const schemaPath = join(process.cwd(), "packages/db/src/schema.ts");
const schema = readFileSync(schemaPath, "utf8");

if (!schema.includes('orderId: uuid("order_id")')) {
  fail("Schema is missing tickets.order_id definition.");
}

if (!schema.includes(".references(() => orders.id)")) {
  fail(
    "Schema is missing tickets.order_id foreign key reference to orders.id.",
  );
}

if (!schema.includes(".notNull()")) {
  fail("Schema contract check expected notNull() on tickets.order_id.");
}

const migrationDir = join(process.cwd(), "packages/db/drizzle");
const migrationFiles = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const functionMigrations = migrationFiles
  .map((fileName) => ({
    fileName,
    content: readFileSync(join(migrationDir, fileName), "utf8"),
  }))
  .filter(({ content }) =>
    content.includes("CREATE OR REPLACE FUNCTION buy_ticket("),
  );

if (functionMigrations.length === 0) {
  fail("No migration contains CREATE OR REPLACE FUNCTION buy_ticket(...).");
}

const latest = functionMigrations[functionMigrations.length - 1];

if (
  !latest.content.includes(
    "INSERT INTO tickets (event_id, order_id, first_name, last_name)",
  )
) {
  fail(
    `Latest buy_ticket function migration (${latest.fileName}) does not insert tickets.order_id.`,
  );
}

if (
  !latest.content.includes(
    "VALUES (p_event_id, p_order_id, p_first_name, p_last_name)",
  )
) {
  fail(
    `Latest buy_ticket function migration (${latest.fileName}) does not pass p_order_id into ticket insert.`,
  );
}

if (!latest.content.includes("UPDATE orders")) {
  fail(
    `Latest buy_ticket function migration (${latest.fileName}) does not update orders after successful ticket creation.`,
  );
}

if (!latest.content.includes("WHERE order_id = p_order_id")) {
  fail(
    `Latest buy_ticket function migration (${latest.fileName}) does not look up the existing ticket for duplicate order ids.`,
  );
}

if (!latest.content.includes("SET status = 'completed', updated_at = NOW()")) {
  fail(
    `Latest buy_ticket function migration (${latest.fileName}) does not mark orders as completed on success.`,
  );
}

console.log(
  `[debug:buy-ticket-contract] Schema and latest buy_ticket migration contract look good (${latest.fileName}).`,
);
