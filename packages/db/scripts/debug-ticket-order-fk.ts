import { Client } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/high_frequency_tickets";

const fail = (message: string): never => {
  console.error(`[db:debug:ticket-order-fk] ${message}`);
  process.exit(1);
};

const main = async () => {
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const columnResult = await client.query<{
      is_nullable: "YES" | "NO";
      data_type: string;
    }>(
      `
        SELECT is_nullable, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tickets'
          AND column_name = 'order_id'
      `,
    );

    if (columnResult.rows.length === 0) {
      fail("tickets.order_id column is missing.");
    }
    const column = columnResult.rows[0]!;

    if (column.is_nullable !== "NO") {
      fail("tickets.order_id must be NOT NULL.");
    }

    const fkResult = await client.query<{
      table_name: string;
      column_name: string;
    }>(
      `
        SELECT ccu.table_name, ccu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
         AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = 'tickets'
          AND kcu.column_name = 'order_id'
      `,
    );

    const fk = fkResult.rows.find(
      (row) => row.table_name === "orders" && row.column_name === "id",
    );

    if (!fk) {
      fail("Foreign key tickets.order_id -> orders.id is missing.");
    }

    console.log(
      "[db:debug:ticket-order-fk] Constraint and nullability are valid.",
    );
  } finally {
    await client.end();
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(`Failed to validate tickets.order_id FK: ${message}`);
});
