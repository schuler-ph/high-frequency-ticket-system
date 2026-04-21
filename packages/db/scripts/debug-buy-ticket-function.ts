import { Client } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/high_frequency_tickets";

const fail = (message: string): never => {
  console.error(`[db:debug:buy-ticket-function] ${message}`);
  process.exit(1);
};

const main = async () => {
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const definitionResult = await client.query<{ definition: string }>(
      `
        SELECT pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        INNER JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'buy_ticket'
        ORDER BY p.oid DESC
        LIMIT 1
      `,
    );

    if (definitionResult.rows.length === 0) {
      fail("buy_ticket function is missing in public schema.");
    }
    const definition = definitionResult.rows[0]!.definition;

    if (
      !definition.includes(
        "INSERT INTO tickets (event_id, order_id, first_name, last_name)",
      )
    ) {
      fail("buy_ticket function does not insert order_id into tickets.");
    }

    if (
      !definition.includes(
        "VALUES (p_event_id, p_order_id, p_first_name, p_last_name)",
      )
    ) {
      fail(
        "buy_ticket function does not pass p_order_id to ticket insert values.",
      );
    }

    if (!definition.includes("UPDATE orders")) {
      fail(
        "buy_ticket function does not update orders after successful ticket insert.",
      );
    }

    if (!definition.includes("SET status = 'completed', updated_at = NOW()")) {
      fail("buy_ticket function does not mark orders as completed on success.");
    }

    console.log(
      "[db:debug:buy-ticket-function] buy_ticket function contract is valid.",
    );
  } finally {
    await client.end();
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(`Failed to validate buy_ticket function contract: ${message}`);
});
