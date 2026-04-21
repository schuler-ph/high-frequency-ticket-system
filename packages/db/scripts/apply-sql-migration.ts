import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/high_frequency_tickets";

const ledgerTable = "drizzle_sql_migrations";

const fail = (message: string): never => {
  console.error(`[db:apply-sql] ${message}`);
  process.exit(1);
};

const normalizeTag = (input: string): string =>
  input.endsWith(".sql") ? input.slice(0, -4) : input;

const readRequestedTag = (): string | undefined => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return undefined;
  }

  const separatorIndex = args.indexOf("--");
  if (separatorIndex >= 0) {
    return args[separatorIndex + 1];
  }

  return args[0];
};

const pickLatestTag = (migrationDir: string): string => {
  const tags = readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, -4))
    .sort();

  if (tags.length === 0) {
    fail(`No SQL migrations found in ${migrationDir}`);
  }

  return tags[tags.length - 1]!;
};

const main = async () => {
  const requestedTag = readRequestedTag();
  const migrationDir = join(process.cwd(), "drizzle");
  const tag = requestedTag
    ? normalizeTag(requestedTag)
    : pickLatestTag(migrationDir);
  const migrationPath = join(migrationDir, `${tag}.sql`);
  const migrationSql = readFileSync(migrationPath, "utf8").trim();

  if (migrationSql.length === 0) {
    fail(`Migration file is empty: ${migrationPath}`);
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${ledgerTable} (
        tag text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    const alreadyApplied = await client.query<{ tag: string }>(
      `SELECT tag FROM ${ledgerTable} WHERE tag = $1`,
      [tag],
    );

    if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
      console.log(
        `[db:apply-sql] Migration ${tag} already applied (ledger: ${ledgerTable}).`,
      );
      return;
    }

    await client.query("BEGIN");
    await client.query(migrationSql);
    await client.query(`INSERT INTO ${ledgerTable} (tag) VALUES ($1)`, [tag]);
    await client.query("COMMIT");

    console.log(
      `[db:apply-sql] Applied ${tag}.sql and recorded it in ${ledgerTable}.`,
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failures and report the original error below.
    }

    const message = error instanceof Error ? error.message : String(error);
    fail(`Failed to apply SQL migration ${tag}: ${message}`);
  } finally {
    await client.end();
  }
};

void main();
