# Phase 4.6: Standard-Flow-Optimierung (vgl. `docs/reports/ANALYSIS-STANDARD-FLOW.md`)

Abgeschlossene Detailnotiz zur Standard-Flow-Optimierung aus Phase 4.6. Messergebnisse stehen in den verlinkten Reports.

### #5 Reservation-Ledger statt Keyspace-SCAN

> - [x] #5 (durch Baseline A praezisiert): Accepted-but-not-finalized Reservations als ZSet/Ledger (`tickets:event:{eventId}:reservations`, Score = Erstellungszeit, kein TTL) statt Keyspace-SCAN; Entfernung nur durch Worker-Finalisierung (`ZREM` im Finalize-Script) / Kompensation. Reconcile zaehlt via `ZCARD` (O(1)) statt SCAN; Ablauf ist nur ein Stale-Kandidat (`ZCOUNT` → `reservation_ledger_stale`-Gauge, Schwellwert `RESERVATION_STALE_SECONDS`) fuer den Reaper (Phase 6), **keine** automatische Rueckbuchung. Behebt das Baseline-A-Oversell-Risiko (temporaer -314k Drift bei 120-s-TTL vs. ~406-s-E2E). Neuer ADR-026, ADR-022/023-Status aktualisiert; Lua gegen `hts-redis` verifiziert. Regressionstest: Reconcile bucht bei alten/stale Reservierungen kein Inventar zurueck.
