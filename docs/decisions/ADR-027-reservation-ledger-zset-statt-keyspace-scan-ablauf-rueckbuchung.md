# ADR-027: Reservation-Ledger (ZSet) statt Keyspace-SCAN — Ablauf ≠ Rueckbuchung

- **Datum:** 2026-07-15
- **Kontext:** Baseline A (`docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md`) legte zwei Probleme im Reservation-Accounting offen:
  1. **Korrektheit (Oversell-Risiko):** Reservierungen lagen als per-`orderId`-Redis-Keys mit 120-s-TTL vor. Bei ~2.000 Accepts/s gegen ~500/s Worker-Drain wuchs die Queue-Latenz auf im Mittel ~406 s. Die 120-s-Keys liefen also ab, waehrend die zugehoerige Order noch unverarbeitet in Pub/Sub lag. Der Reconcile zaehlte die abgelaufene Reservierung nicht mehr (`available` blieb aber dekrementiert) → Drift fiel auf **-314k** → Reconcile buchte `available` positiv zurueck und machte damit noch beanspruchtes Inventar erneut verkaufbar. Waehrend eines laufenden Sales fuehrt das zu Ueberverkauf.
  2. **Skalierung:** `countActiveReservations` zaehlte per `SCAN MATCH tickets:event:{id}:reservation:*`. `SCAN` iteriert immer den gesamten Keyspace (nach 1 Mio. Verkaeufen ~2 Mio. Keys aus `orders:*` + `processed:*`) und filtert erst danach — pro Reconcile-Lauf zehntausende Roundtrips fuer eine Zahl, die >99 % der Keys nie betrifft.
- **Entscheidung:** Akzeptierte, noch nicht finalisierte Reservierungen werden in einem **Sorted Set pro Event** gefuehrt: `tickets:event:{eventId}:reservations`, Score = Erstellungszeit (Unix-ms, identisch mit `queuedAt`), Member = `orderId`.
  1. **Kein TTL.** Der Ledger-Eintrag ist ein Inventar-Anspruch, der ausschliesslich durch **Worker-Finalisierung (Erfolg)** oder **Kompensation (terminaler Fehler)** verschwindet — beide per `ZREM` im jeweiligen atomaren Script. Die frueheren per-`orderId`-Reservation-Keys mit TTL entfallen ersatzlos.
  2. **Zaehlung = `ZCARD`** (O(1)): Jeder Eintrag zaehlt als aktiver Anspruch, unabhaengig vom Alter. Warteschlangen-Latenz kann keine offene Reservierung mehr "ablaufen" lassen; die Drift bleibt bei ~0.
  3. **Ablauf ≠ Rueckbuchung.** Alter wird nur als **Stale-Signal** ausgewertet: `ZCOUNT reservations 0 (now − RESERVATION_STALE_SECONDS·1000)` liefert Reaper-Kandidaten als Gauge `reservation_ledger_stale`. Der Reconcile bucht auf Basis dieses Signals **nie** automatisch Inventar zurueck — die sichere Rueckgewinnung abgebrochener `pending`-Ansprueche uebernimmt Phase 4.9 identitaetsbasiert per Reaper (ADR-031).
  4. **Erfolgspfad entfernt den Anspruch aktiv:** `finalizeOrderProcessing` macht zusaetzlich zu Order-Cache + `processed`-Marker ein `ZREM`. Der Anspruch geht in `sold_count` ueber und darf nicht doppelt (als aktive Reservierung UND als Verkauf) zaehlen. `available` wird beim Erfolg **nicht** inkrementiert (das Ticket ist verkauft) — nur die Kompensation bucht `available` zurueck.
- **Begruendung:**
  - Der Kern der Baseline-A-Drift war nicht die SCAN-Dauer, sondern die **TTL-getriebene Freigabe** eines noch beanspruchten Inventars. Ein reines Umstellen von `SCAN`+`ZCOUNT <now> +inf` auf Score=Ablaufzeit haette den Bug reproduziert (abgelaufene Eintraege fielen aus der Zaehlung). Score=Erstellungszeit + `ZCARD` trennt "aktiver Anspruch" (Kardinalitaet) sauber von "verdaechtig alt" (Score-Range) — nur so ist Ablauf ein Signal statt einer stillen Freigabe.
  - `ZCARD` ist O(1), `ZCOUNT` O(log n) — beide unabhaengig von der Gesamtgroesse des Keyspace. Die 20.000-Roundtrip-Landmine des SCAN entfaellt.
  - Idempotenz bleibt gewahrt: `ZREM` liefert 1 nur beim ersten Entfernen; Rollback- und Kompensations-Script inkrementieren `available` genau dann. Gegen echtes `hts-redis` verifiziert.
- **Trade-off / bewusst offen:** Bis Phase 4.9 akkumulieren Ansprueche von Orders, die **nie** finalisiert werden, dauerhaft im Ledger und mindern `available` als Phantom-Claims. Die `reservation_ledger_stale`-Gauge macht den Effekt sichtbar; ADR-031 zieht den sicheren Pending-Reaper vor das Cloud-Deployment.
- **Alternativen (verworfen):**
  - **Stopgap `REDIS_RESERVATION_TTL_SECONDS` 120→900 s:** ~10 Minuten Aufwand, aber maskiert den Bug nur fuer Laeufe kuerzer als die TTL und laesst die SCAN-Landmine bestehen. Keine strukturelle Loesung.
  - **Score = Ablaufzeit + `ZCOUNT now +inf`:** effizient, reproduziert aber exakt das Oversell-Verhalten (Ablauf entfernt aus der Zaehlung).
  - **Reaper sofort mit-bauen:** war fuer den damaligen Fix ein groesserer Scope; nach den Baseline-C/D-Befunden wird er in Phase 4.9 vorgezogen und nach ADR-031 umgesetzt.
- **Umsetzung:**
  - `packages/types/src/redis-keys.ts` (`reservations`-ZSet, `reservation(orderId)` entfernt)
  - `packages/types/src/redis-client.ts` (`zcard`/`zcount`, `scan` entfernt)
  - `packages/env/src/index.ts` (`RESERVATION_STALE_SECONDS`, `REDIS_RESERVATION_TTL_SECONDS` entfernt)
  - `apps/api/src/lib/redis-scripts.ts` (Reserve: `ZADD`; Release: `ZREM`)
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/worker/src/lib/redis-scripts.ts` (Finalize: `ZREM`; Compensate: `ZREM`)
  - `apps/worker/src/lib/reconcile-ticket-availability.ts` (`ZCARD`/`ZCOUNT` statt SCAN, Stale-Messung)
  - `apps/worker/src/lib/metrics.ts` (`reservation_ledger_active`, `reservation_ledger_stale`)
  - `apps/worker/src/routes/pubsub-listener.ts` (Verdrahtung)
  - `docs/ARCHITECTURE.md`, `docs/TODO.md`
