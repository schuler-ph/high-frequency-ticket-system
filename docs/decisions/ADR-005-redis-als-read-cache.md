# ADR-005: Redis als Read-Cache

- **Datum:** 2026-02-24
- **Kontext:** Die API muss Ticket-Verfügbarkeiten in Sub-Millisekunden-Bereich liefern. Direkte DB-Reads unter Last sind zu langsam und überlasten PostgreSQL.
- **Entscheidung:** Cloud Memorystore (Redis) als exklusive Read-Quelle für die API. Worker aktualisiert den Cache nach erfolgreichen DB-Writes.
- **Begründung:** Redis liefert konsistente Reads im Mikrosekunden-Bereich. Atomic Decrement (`DECR`) verhindert Overselling. Eventual Consistency ist akzeptabel für Verfügbarkeitsanzeige.
- **Alternativen:** DB-Read-Replicas (teurer, höhere Latenz), Application-Level Cache (nicht cluster-fähig).

### Update 2026-03-15: Event-spezifische Redis-Key-Namenskonvention

- **Kontext:** Globale Redis-Keys (`tickets:total`, `tickets:available`) mischen bei mehreren Events die Verfuegbarkeiten und erschweren parallele Sales.
- **Entscheidung:** Ticket-Counter werden event-spezifisch gespeichert: `tickets:event:{eventId}:total` und `tickets:event:{eventId}:available`.
- **Begruendung:** Klare Isolation pro Event, korrekte Availability-Reads bei Multi-Event-Szenarien, und weniger Risiko fuer Key-Kollisionen.
- **Umsetzung:** API nutzt ab sofort event-spezifische Keys in Buy-/Availability-/Reset-Flow.

### Update 2026-03-15: Zentrales Redis-Key-Naming-Utility

- **Kontext:** Redis-Key-Strings wurden initial service-lokal gepflegt. Dadurch steigt bei weiteren Flows (z.B. Kompensation im Worker) das Risiko fuer Tippfehler und Drift zwischen API und Worker.
- **Entscheidung:** Redis-Key-Namen werden zentral in `@repo/types/redis-keys` definiert und in den Services importiert, statt lokal als String-Literale gepflegt.
- **Begruendung:** Ein gemeinsamer, typisierter Einstiegspunkt reduziert Drift, vereinfacht Refactorings und erzwingt konsistente Key-Schemata ueber Service-Grenzen hinweg.
- **Umsetzung:** Shared Utility in `packages/types/src/redis-keys.ts`; API-Routen verwenden den Import aus `@repo/types/redis-keys`.

### Update 2026-03-15: Atomare Reservierung ohne Negative Counter

- **Kontext:** Der bisherige Buy-Flow verwendete `DECR` mit nachgelagertem Rollback bei negativen Werten. Dadurch wurde kurzfristig auch bei Sold-Out dekrementiert und erst danach kompensiert.
- **Entscheidung:** Die API reserviert Tickets atomar per Redis-Lua-Skript: dekrementiere nur, wenn `available > 0`, sonst liefere sofort Sold-Out ohne Counter-Aenderung.
- **Begruendung:** Striktere Sold-Out-Korrektheit unter hoher Konkurrenz, kein temporaer negativer Zaehlerstand und keine unnoetige Kompensationsoperation im Konfliktfall.
- **Umsetzung:** `apps/api/src/routes/api/tickets/buy.ts` nutzt `EVAL` fuer Check+Decrement in einem atomaren Redis-Schritt.

### Update 2026-03-21: Reservation-Key pro Order mit TTL

- **Kontext:** Nach erfolgreicher atomarer Reservierung musste der temporäre Reservierungszustand pro Kauf nachvollziehbar in Redis gehalten werden, um spaetere Kompensation/Reconcile konsistent aufbauen zu koennen.
- **Entscheidung:** Die API schreibt pro Kauf einen Reservation-Key `tickets:event:{eventId}:reservation:{orderId}` mit TTL in Redis.
- **Begruendung:** Die explizite Reservation entkoppelt temporaeren Kaufzustand von persistenten Orders und laesst stale Reservierungen automatisch auslaufen. Bei Publish-Fehlern wird die Reservation sofort geloescht und der Availability-Counter per `INCR` kompensiert.
- **Umsetzung:**
  - `packages/types/src/redis-keys.ts`
  - `packages/env/src/index.ts`
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/api/test/routes/tickets.buy.test.ts`

### Update 2026-07-12: Reserve+Reservation+Pending als ein atomares Lua-Script (EVALSHA)

- **Kontext:** Der Buy-Hot-Path bezahlte drei sequenzielle Redis-Roundtrips (EVAL Check+DECR, SET Reservation-Key, SET Pending-Order) und brauchte einen mehrstufigen manuellen Rollback fuer den Zwischenzustand "Reservation gesetzt, Pending-Write fehlgeschlagen". `redis.eval()` uebertrug zudem den Script-Text bei jedem Request neu (vgl. `docs/reports/ANALYSIS-STANDARD-FLOW.md`, Massnahme 1).
- **Entscheidung:** Check+DECR, Reservation-Key und Pending-Order-Key laufen in **einem** Lua-Script, registriert via ioredis `defineCommand` (EVALSHA mit automatischem Fallback). Der einzige verbleibende Fehlerpfad (Pub/Sub-Publish fehlgeschlagen) wird durch ein ebenso atomares Gegen-Script kompensiert: `DEL reservation` → `INCR available` nur bei tatsaechlich geloeschter Reservation → `DEL` Pending-Order.
- **Begruendung:** 3→1 Roundtrip pro Kauf im API-Hot-Path, keine partiellen Zwischenzustaende und kein mehrstufiger Rollback-Code mehr; das Gegen-Script ist idempotent (kein Double-Increment bei Wiederholung). Die Semantik aus dem ADR-017-Update 2026-04-22 (Inventory-Rollback garantiert, Pending-Cleanup darf es nicht blockieren) bleibt erhalten und wird stärker: alles ist ein atomarer Schritt.
- **Cluster-Caveat:** Das Script mischt Hash-Slots (`tickets:event:…` und `orders:…`) — zulaessig auf nicht-geclustertem Memorystore/Redis. Falls Redis Cluster je ein Thema wird, sind Hash-Tags einzuplanen und dieses ADR zu aktualisieren.
- **Umsetzung:**
  - `apps/api/src/lib/redis-scripts.ts`
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/api/test/routes/tickets.buy.test.ts`
  - `tests/e2e/test/buy-order-flow.test.ts` / `buy-order-flow.failure.test.ts`
