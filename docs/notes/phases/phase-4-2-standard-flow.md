# Phase 4.2: Standard-Flow-Optimierung (vgl. `docs/reports/ANALYSIS-STANDARD-FLOW.md`)

Abgeschlossene Detailnotiz zur Standard-Flow-Optimierung aus Phase 4.2. Messergebnisse stehen in den verlinkten Reports.

### #5 Reservation-Ledger statt Keyspace-SCAN

> - [x] #5 (durch Baseline A praezisiert): Accepted-but-not-finalized Reservations als ZSet/Ledger (`tickets:event:{eventId}:reservations`, Score = Erstellungszeit, kein TTL) statt Keyspace-SCAN; Entfernung nur durch Worker-Finalisierung (`ZREM` im Finalize-Script) / Kompensation. Reconcile zaehlt via `ZCARD` (O(1)) statt SCAN; Ablauf ist nur ein Stale-Kandidat (`ZCOUNT` → `reservation_ledger_stale`-Gauge, Schwellwert `RESERVATION_STALE_SECONDS`) fuer den Reaper (Phase 6), **keine** automatische Rueckbuchung. Behebt das Baseline-A-Oversell-Risiko (temporaer -314k Drift bei 120-s-TTL vs. ~406-s-E2E). Neuer ADR-026, ADR-022/023-Status aktualisiert; Lua gegen `hfts-redis` verifiziert. Regressionstest: Reconcile bucht bei alten/stale Reservierungen kein Inventar zurueck.

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

Risikoarme Massnahmen (Analyse §9, Nr. 1/2/6/8/10) und der Handler-Block (Nr. 3/4) — umgesetzt:

- [x] #10: Redis-Typ-Schatten/Casts durch zentrales `@repo/types/redis-client` ersetzen; Zod-Parse selbst konstruierter Literale durch `satisfies` (Zod bleibt an allen externen Grenzen).
- [x] #1: Reserve+Reservation+Pending-Order als **ein** atomares Lua-Script via ioredis `defineCommand`/EVALSHA; Publish-Rollback als idempotentes Gegen-Script (3→1 RTT, ADR-005-Update).
- [x] #2: Worker Idempotenz-Check+Lock als ein Script (`beginOrderProcessing`), Finalisierung (Order-Cache + `processed`-Marker + Lock-Release) als ein Script (5→2 RTT pro Message, ACK/NACK-Semantik unveraendert).
- [x] #6: Reconcile korrigiert `available` als Delta (`INCRBY`) statt absolutem `MSET` (schliesst das Lost-Decrement-Fenster); `redis_db_drift_tickets`-Gauge (ADR-023) verdrahtet.
- [x] #8: `PUBSUB_FLOW_CONTROL_MAX_MESSAGES` (Default 500) und `DATABASE_POOL_MAX` (Default 20) als explizite, aufeinander abgestimmte Env-Knobs (siehe ARCHITECTURE.md "Worker-Durchsatz & Backpressure").
- [x] #3: Handler liefert `BuyTicketOutcome`-Wert; ACK/NACK + Metriken als Policy-Tabelle (`buyTicketOutcomePolicy`) im Listener — die Doku-Tabelle ist woertlich Code, ack/nack genau einmal pro Nachricht.
- [x] #4: `processing`-Lock gestrichen — Idempotenz traegt die `buy_ticket`-DB-Transaktion (ON CONFLICT); `processed`-Marker bleibt als Redelivery-Shortcut (ADR-004-Update, Key-Lifecycle-/ACK-NACK-Tabelle, Worker-Reliability-Dashboard).

Offene Folge-Massnahmen (Analyse §9, vor dem naechsten grossen Lasttest):

- [x] Lokalen Lasttest als Baseline ausfuehren und Vorher-Zahlen fuer #5/#7 dokumentieren (`docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md`).
- [x] **#5 Reservation-Ledger (ZSet) statt Keyspace-SCAN:** Reconcile zaehlt via `ZCARD` (O(1)), Ablauf ist nur Stale-Kandidat statt Rueckbuchung — behebt das Baseline-A-Oversell-Risiko. → ADR-027
