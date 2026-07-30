# Phase 6: Optional & Resilience (Maximum Learning)

Offene Detailnotiz zu Resilience-Themen aus Phase 6. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

### Reaper-Job fuer stale pending Orders und Ledger-Reservationen

> - [ ] Ergänze Reaper-Job fuer stale `pending` Orders und stale Ledger-Reservationen inkl. sicherer Kompensation. Datenbasis liegt seit ADR-026 vor: `ZRANGEBYSCORE tickets:event:{eventId}:reservations 0 (now − RESERVATION_STALE_SECONDS·1000)` liefert die Kandidaten deterministisch, die `reservation_ledger_stale`-Gauge macht den Bestand sichtbar. Rueckgewinnung nur nach Order-/Queue-Recovery (DLQ), nicht allein wegen Alter.
