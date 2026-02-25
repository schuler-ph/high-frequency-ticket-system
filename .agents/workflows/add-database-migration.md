---
description: Wie man eine neue Datenbank-Migration mit Drizzle ORM erstellt und anwendet.
---

# Workflow: Add Database Migration

1. **Schema anpassen**: Bearbeite die Tabellen-Definitionen, Relationen oder Enums in `packages/db/src/schema.ts` (oder wo auch immer die Schemas liegen).
2. **Typ-Status überprüfen**: Nutze wo immer möglich `$inferSelect` und `$inferInsert` für die Ableitung der Types, um manuelle Typ-Duplikate zu verhindern.
3. **Migration generieren**: Führe den Drizzle-Kit Befehl aus, um aus den Schema-Änderungen eine SQL-Migrationsdatei zu generieren.
   `pnpm --filter db run generate` (Befehl kann je nach `package.json` in `packages/db` variieren).
4. **SQL-Datei prüfen**: Öffne den neu erstellten SQL-Dump im `drizzle/`-Ordner (oder dem konfigurierten Output-Verzeichnis) und verifiziere, dass keine destruktiven Änderungen ohne dein Wissen stattfinden (z.B. ungewolltes DROP TABLE).
5. **Lokale Migration anwenden**: Pushe die Änderungen in deine laufende lokale Code-Datenbank (z.B. im Docker-Container).
   `pnpm --filter db run push` oder `pnpm --filter db run migrate`
