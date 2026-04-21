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

## 2.5) Lokales Reset + Seed (PostgreSQL, Redis, Pub/Sub)

```bash
pnpm run local:reset-seed
```

Der Befehl fuehrt deterministisch aus:

- `db:push` fuer das aktuelle Drizzle-Schema
- Reset + Seed der Tabellen `events`, `orders`, `tickets`
- `FLUSHDB` in Redis + event-spezifische `total`/`available` Keys
- Recreate von Pub/Sub Topic + Subscription im lokalen Emulator

Wenn ein Container nicht laeuft (`hts-postgres`, `hts-redis`, `hts-pubsub`), bricht das Skript mit einem klaren Hinweis ab.

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

- API, Worker und `@repo/db` laufen direkt ueber `node --import tsx --test`
- keine Shared-Test-Runner oder Wrapper-Entrypoints zwischen Paketskript und Testdateien
- Coverage bleibt in `test:coverage` oder `test:ci`, damit lokale `test`-Laeufe schnell bleiben

## 7) Testdauer korrekt messen

Turbo kann bei Cache-Hits alte Paket-Logs inklusive historischer `duration_ms` Werte wiedergeben. Diese Werte sind dann nicht die Laufzeit des aktuellen Befehls.

Fuer echte Laufzeitmessungen nutze:

```bash
env CI=1 pnpm exec turbo run test --ui=stream --force
```

Oder fuer den benutzerseitigen Root-Befehl:

```bash
/usr/bin/time -p pnpm test
```

Wenn `turbo` Cache-Hits replayt, ist die relevante Zahl die echte Shell-Zeit (`real`), nicht die alte `duration_ms` aus den wiedergegebenen Logs.

## Node-Kompatibilitaet

Aktuell ist das Repo auf Node 24 als Primär-Runtime ausgerichtet, unterstützt aber Node 22+:

- `package.json` engines: `>=22`
- CI-Quality-Job: Node 22 und 24 (Matrix)
- CI-Test-Job: Node 24 (Primär-Runtime)
