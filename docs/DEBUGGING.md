# Debugging Runbook (Kurzversion)

Dieses Runbook beschreibt den schnellsten Weg, um lokale Test- oder Datenbank-Probleme reproduzierbar zu analysieren.

## 1) Runtime verifizieren

```bash
pnpm run debug:runtime
```

Erwartung:

- Node 24.x
- NODE_OPTIONS ist leer oder bewusst gesetzt

## 2) Lokale Infrastruktur pruefen (vor Tests)

```bash
pnpm run preflight:test
```

Wenn Container fehlen oder gestoppt sind, gibt der Befehl einen klaren Fehler inklusive Fix aus:

```bash
docker compose up -d
```

Hinweis: In CI wird der Preflight automatisch uebersprungen.

## 3) Migrationen/Journal pruefen

```bash
pnpm run debug:migrations
```

Der Check validiert:

- konsistente `idx`-Reihenfolge in `packages/db/drizzle/meta/_journal.json`
- eindeutige Migrationstags
- zu jedem Journal-Eintrag eine passende SQL-Datei
- keine doppelten SQL-Prefixe (z.B. zwei `0004_*`)

## 4) buy_ticket-Vertrag statisch pruefen

```bash
pnpm run debug:buy-ticket-contract
```

Der Check validiert:

- `tickets.order_id` existiert im Drizzle-Schema
- FK-Referenz auf `orders.id` und `NOT NULL`
- neueste Migration mit `buy_ticket(...)` schreibt `order_id` in `tickets`

## 5) Live-DB-Vertrag pruefen (optional, lokal)

```bash
pnpm run debug:db:ticket-order-fk
pnpm run debug:db:buy-ticket-function
```

Diese Checks greifen direkt auf PostgreSQL zu (via `DATABASE_URL`, fallback auf lokale Docker-Defaults) und validieren den echten Runtime-Stand der DB.

## 6) Tests deterministisch ausfuehren

```bash
pnpm run test
```

Wichtige Hardening-Punkte:

- fester Test-Entrypoint pro Service (`test/run-tests.ts`)
- `NODE_OPTIONS=''` in API/Worker-Testskripten
- Top-Level-Logging fuer `uncaughtException`/`unhandledRejection`

## Node-Kompatibilitaet

Aktuell ist das Repo auf Node 24 als Primär-Runtime ausgerichtet, unterstützt aber Node 22+:

- `package.json` engines: `>=22`
- CI-Quality-Job: Node 22 und 24 (Matrix)
- CI-Test-Job: Node 24 (Primär-Runtime)
