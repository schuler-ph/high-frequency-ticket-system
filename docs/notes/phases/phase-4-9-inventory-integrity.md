# Phase 4.9: Redis-authoritatives Inventory

## Ziel

Phase 4.9 entfernt den schreibenden Redis/PostgreSQL-Reconcile aus dem Live-Sale. Redis ist waehrend des Verkaufs die einzige Autoritaet fuer `available` und aktive Reservierungen. PostgreSQL bleibt die dauerhafte Wahrheit fuer abgeschlossene Ticketverkaeufe.

Der bisherige Reconcile vermischt vier Verantwortlichkeiten:

1. Redis-`available` aus einem nicht atomaren Cross-System-Snapshot korrigieren.
2. Redis-/DB-Abweichungen als Metrik melden.
3. `COUNT(tickets)` nach `events.sold_count` materialisieren.
4. aktive und alte Reservationen zaehlen.

Die Komponenten werden getrennt, damit Observability und Projektion niemals das Verkaufsinventar veraendern.

## Evidenz

Baseline C endete mit 389 Anspruechen ueber Kapazitaet, weil der damalige Reconcile eine Worker-Finalisierung zwischen DB- und Ledger-Read in keinem Snapshot zaehlte.

Die beiden lokalen Folge-Laeufe mit dem Baseline-C-Fix zeigen einen weiteren Race:

| Run                                | Beobachtung                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `2026-07-27T14-18-37-924Z-b776eb5` | `956.750 sold + 43.374 active + 0 available = 1.000.124`; End-Drift `+124`, Zeitreihe `-280 … +442` |
| `2026-07-27T15-01-01-680Z-f45f45b` | exakter Endzustand, aber transiente Zeitreihe etwa `-234 … +340`                                    |

Beide Läufe enthalten bereits die Reihenfolge Ledger vor massgeblicher DB-Messung. Eine neue Reservierung zwischen `ZCARD reservations` und dem spaeteren `GET available` fehlt trotzdem im Ledger-Snapshot, ist im dekrementierten Counter aber schon sichtbar. Die positive Delta-Korrektur gibt diesen weiterhin gehaltenen Anspruch erneut frei.

## Zielarchitektur

### Inventory-Hot-Path

Nur die fachlichen Lua-Skripte duerfen `available` veraendern:

- Reserve: `DECR available` + `ZADD reservation` atomar.
- Cancel/Pay-Rollback: `ZREM reservation` + `INCR available` nur bei erfolgreichem `ZREM`.
- Terminale Worker-Kompensation: dieselbe idempotente Freigabe.
- Erfolgreiche Worker-Finalisierung: `ZREM reservation`; kein `INCR`, weil das Ticket verkauft ist.

Auditor, Projector und Report-Automation schreiben niemals `available`.

### Inventory Auditor

Der Auditor ersetzt den messenden Teil des Reconcile und ist read-only. Pro Event erfasst er:

- `totalCapacity` aus PostgreSQL beziehungsweise dem Seed-Snapshot,
- `sold = COUNT(tickets)` aus PostgreSQL,
- `available` aus Redis,
- `activeReservations = ZCARD reservations`,
- `staleReservations = ZCOUNT` gegen den Stale-Schwellwert,
- `capacityDelta = available + sold + activeReservations - totalCapacity`.

Der Cross-System-Snapshot ist waehrend paralleler Reserve-/Finalize-Vorgaenge nicht atomar. Ein einzelner Ausschlag ist deshalb Diagnose, keine automatische Reparaturanweisung. Nach abgeschlossenem Drain muss `capacityDelta == 0` gelten.

Vorgesehene Metriken:

- bestehendes `redis_db_drift_tickets` entweder kompatibel als `inventory_capacity_delta_tickets` umbenennen oder waehrend einer Uebergangsphase unter beiden Namen exponieren,
- `reservation_ledger_active`,
- `reservation_ledger_stale`,
- `inventory_audit_runs_total{result}`,
- `inventory_audit_duration_seconds`,
- `inventory_audit_last_success_timestamp_seconds`.

Fehlende Redis-Inventar-Keys erzeugen einen Audit-Fehler und niemals eine automatische Initialisierung. Der vollstaendige Verlust von Redis-Daten und Redis-HA sind bewusst nicht Teil dieser Phase.

### Sold-count Projector

`events.sold_count` ist ein abgeleitetes DB-Read-Model. Der Projector:

1. fuehrt genau eine gruppierte `COUNT(tickets)`-Aggregation aus,
2. aktualisiert `events.sold_count`,
3. teilt den bereits gelesenen Snapshot mit dem Auditor,
4. schreibt nicht nach Redis.

Der Projector liegt nicht auf dem Kauf-Hot-Path und nimmt keinen `events`-Row-Lock pro Ticket. Trotzdem kann ein wiederholter Full-/Index-Scan bei einer Million Tickets I/O und CPU waehrend eines lokalen Lasttests verbrauchen. Deshalb gelten folgende Guardrails:

- nur eine Aggregation pro Zyklus; der bisherige doppelte Snapshot-Read entfaellt,
- Default-Intervall zunaechst 60 Sekunden, nicht 10 Sekunden,
- Query-Dauer und Fehler ueber das bestehende DB-/Runtime-Instrumentarium messen,
- `events.sold_count` ist weder Admission- noch Korrektheitsvoraussetzung,
- falls der Projector den Kapazitaetslauf messbar beeinflusst, darf er im Kapazitaetsprofil pausieren und nach dem Drain einmal laufen.

Ein spaeteres inkrementelles oder partitioniertes Read-Model ist erst mit Messbeleg sinnvoll. Der Hot-Row-Update pro Ticket bleibt verboten.

### Reaper

Der Reaper wird aus Phase 6 in Phase 4.9 vorgezogen, weil er die fachlich zulaessige Rueckgewinnung verwaister Reservierungen traegt.

TTL allein ist kein korrekter Release-Mechanismus:

- Redis garantiert keine Ausfuehrung exakt im Ablauf-Millisekundenpunkt; Expiry erfolgt aktiv und lazy.
- Das Ablaufen eines Keys kann nicht atomar `ZREM reservation` und `INCR available` ausfuehren.
- Alter beweist nicht, dass eine Order unbezahlt, unveroeffentlicht oder nicht gerade in Finalisierung ist.
- Keyspace Notifications sind best effort und kein verlaesslicher Job-Trigger.

Die Ablaufzeit bleibt trotzdem millisekundengenau als **Eligibility Deadline** im ZSet-Score erhalten. Der Reaper darf eine Reservation nie vor dieser Deadline freigeben; die tatsaechliche Freigabe erfolgt im naechsten Reaper-Lauf.

Vor der Implementierung wird der Checkout-Zustand explizit gemacht:

- `pending`: darf nach Deadline freigegeben werden,
- `publishing|paid`: darf der Reaper nicht automatisch freigeben,
- `completed|failed|cancelled|released`: terminal.

`POST /pay` muss `pending → publishing` atomar claimen, bevor es published. Reaper, Pay und Cancel konkurrieren damit auf demselben Redis-Zustand. Nur der Gewinner darf den Ledger-Eintrag entfernen oder weiterverarbeiten.

Der erste Reaper-Scope gibt ausschliesslich nachweislich abgelaufene `pending`-Reservierungen per Lua atomar frei. Unklare `publishing|paid`-Faelle bleiben gehalten und werden als Recovery-Kandidaten gemeldet; DLQ-/Outbox-Recovery bleibt Phase 6.

Der Pending-Order-Key darf nicht vor der Reaper-Entscheidung per TTL verschwinden. Entweder bleibt er waehrend der aktiven Reservation ohne TTL oder seine Cleanup-TTL liegt garantiert hinter Reservation-Deadline plus Reaper-Grace. Finale Read-Models behalten ihre begrenzte TTL.

Vorgesehene Metriken:

- `reservation_reaper_candidates`,
- `reservation_reaper_releases_total`,
- `reservation_reaper_skips_total{reason}`,
- `reservation_reaper_errors_total`,
- `reservation_reaper_oldest_age_seconds`,
- `reservation_reaper_run_duration_seconds`.

## Dashboards

Das vorhandene Dashboard `Reservation & Consistency` wird zum Dashboard `Inventory Integrity` weiterentwickelt; ein neuntes Dashboard ist nicht notwendig.

Beibehalten:

- Reservation Flow,
- Publish Rollback Rate,
- Worker Compensation Rate,
- Reservation Ledger active/stale.

Umbauen beziehungsweise ergaenzen:

1. `Capacity Delta over time`: signierte Zeitreihe mit `min`, `max`, `last`; Beschreibung weist auf transiente Cross-System-Snapshots hin.
2. `Final Capacity Invariant`: `available + sold + active == capacity`, nach Drain zwingend null.
3. `Inventory Components`: Rohwerte `capacity`, `available`, `sold`, `active`, damit ein Delta erklaerbar bleibt.
4. `Auditor Health`: letzte erfolgreiche Ausfuehrung, Dauer und Fehler.
5. `Reaper Activity`: Kandidaten, Releases, Skips nach Grund und Fehler.
6. `Oldest Pending Reservation`: Alter des aeltesten freigabefaehigen Anspruchs.

Das Dashboard `DB & Runtime` zeigt den Projector separat:

- Query-Latenz und Durchsatz fuer `project_sold_counts`,
- Projector-Run-Dauer,
- Fehler beziehungsweise letzte erfolgreiche Projektion,
- Pool-Wait waehrend eines Projector-Laufs.

## Report- und Test-Invarianten

Nach abgeschlossenem Drain muessen mindestens gelten:

```text
available + dbTickets + activeReservations == totalCapacity
reservationsCreated - checkoutsCancelled
  == dbTickets + activeReservations + publishRollbacks + workerCompensations
```

Die zweite Identitaet wird an die exakte Counter-Semantik der Release-Skripte angepasst; nur tatsaechlich freigegebene Ansprueche duerfen gezaehlt werden.

Eine verletzte Capacity-Invariante setzt `system=fail`. Fehlende Operanden setzen `system=inconclusive`. Der Report darf einen Run mit positivem End-Delta nicht mehr als fachlich erfolgreich bewerten.

Zusaetzliche Tests:

- eine neue Reservierung waehrend eines Audit-Laufs kann niemals `available` erhoehen,
- Auditor-Ausfall veraendert Redis nicht,
- Projector-Ausfall veraendert Redis nicht und stoppt den Consumer nicht,
- Pay-vs-Reaper und Cancel-vs-Reaper werden gegen echtes Redis getestet,
- Reaper gibt nie vor Deadline und nie bei `publishing|paid` frei,
- Reaper-Wiederholung erzeugt kein Double-`INCR`,
- Capacity-Invariante schlaegt beim reproduzierten `+124`-Zustand fehl.

## Implementierungsreihenfolge

Jeder Schritt bleibt ein eigener reviewbarer Commit:

1. Capacity-Invariante und Regressionstest fuer den `+124`-Zustand in die Report-Automation aufnehmen.
2. Reconcile-Kern in read-only Auditor und Sold-count Projector trennen; alle Redis-Inventory-Writes aus dem periodischen Pfad entfernen.
3. Lifecycle-Verdrahtung und alte `WORKER_RECONCILE_*`-Konfiguration durch Auditor-/Projector-Konfiguration ersetzen.
4. Checkout-Zustandsautomat und Pay-Claim als Voraussetzung fuer einen sicheren Reaper implementieren.
5. Pending-Reaper samt echten Redis-Race-Tests und Metriken implementieren.
6. `Inventory Integrity` und `DB & Runtime` Dashboards aktualisieren.
7. Vollstaendigen lokalen Lasttest fahren; Erfolg verlangt Capacity-Invariante null nach Drain und keine schreibende Inventory-Korrektur.

## Bewusst nicht Teil von Phase 4.9

- Redis-HA, Redis-Persistenz und Wiederherstellung nach vollstaendigem Datenverlust,
- Rekonstruktion aktiver Reservierungen nach Verlust des gesamten Redis-Zustands,
- DLQ/Outbox-Recovery fuer einen unklaren `publishing`-Zustand,
- Kubernetes Leader Election oder ein dedizierter Reconciler-Service,
- Cloud-Deployment.

Der lokale Spike-Test initialisiert PostgreSQL, Redis und Pub/Sub weiterhin ueber den bestehenden Reset-/Seed-Pfad vor dem Verkauf.
