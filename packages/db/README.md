# Database Workflow

## Schema Changes In This Repo

Wichtig: `pnpm --filter @repo/db run db:generate` erzeugt nur Migrationsdateien unter `packages/db/drizzle`.

Damit Aenderungen wirklich in PostgreSQL landen, muss danach auch `db:push` gegen die laufende Datenbank ausgefuehrt werden:

```bash
pnpm --filter @repo/db run db:generate
pnpm --filter @repo/db run db:push
```

## Raw SQL Function Migrations

`db:push` synchronisiert nur den Drizzle-Schema-Diff aus `src/schema.ts`.
Fuer reine SQL-Function-Aenderungen in `drizzle/*.sql` (ohne Schema-Diff) nutze das wiederverwendbare Apply-Skript:

```bash
pnpm run db:apply-sql
pnpm run db:apply-sql -- 0005_complete_order_on_success
```

Das Skript fuehrt die SQL-Migration in PostgreSQL aus und trackt angewendete Tags idempotent in `drizzle_sql_migrations`.

## Verification

Nach Schema-Aenderungen immer gegen die echte lokale Datenbank verifizieren:

- Container: `hts-postgres`
- Datenbank: `high_frequency_tickets`

Beispiel:

```bash
docker exec -i hts-postgres psql -U postgres -d high_frequency_tickets -c "\\dt"
```

Wenn eine Tabelle in `packages/db/drizzle/*.sql` existiert, aber nicht in PostgreSQL sichtbar ist, wurde in der Regel `db:push` nicht ausgefuehrt.
