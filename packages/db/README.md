# Database Workflow

## Schema Changes In This Repo

Wichtig: `pnpm --filter @repo/db run db:generate` erzeugt nur Migrationsdateien unter `packages/db/drizzle`.

Damit Aenderungen wirklich in PostgreSQL landen, muss danach auch `db:push` gegen die laufende Datenbank ausgefuehrt werden:

```bash
pnpm --filter @repo/db run db:generate
pnpm --filter @repo/db run db:push
```

## Verification

Nach Schema-Aenderungen immer gegen die echte lokale Datenbank verifizieren:

- Container: `hts-postgres`
- Datenbank: `high_frequency_tickets`

Beispiel:

```bash
docker exec -i hts-postgres psql -U postgres -d high_frequency_tickets -c "\\dt"
```

Wenn eine Tabelle in `packages/db/drizzle/*.sql` existiert, aber nicht in PostgreSQL sichtbar ist, wurde in der Regel `db:push` nicht ausgefuehrt.
