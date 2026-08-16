# ADR-031: Redis-authoritatives Inventory — Auditor und Reaper statt schreibendem Reconcile

- **Status:** Fertig
- **Datum:** 2026-07-29
- **Ersetzt:** ADR-022
- **Kontext:** Der Live-Sale reserviert Inventar bereits atomar in Redis (`DECR available` + Ledger-`ZADD`) und gibt es ueber idempotente Lua-Gegenskripte frei. Der periodische Reconcile aus ADR-022 berechnet dagegen `available` aus zeitversetzten Reads von Redis und PostgreSQL und schreibt die vermeintliche Differenz per `INCRBY` zurueck. Baseline C belegte damit 389 Ansprueche ueber Kapazitaet. Zwei lokale Folge-Laeufe nach dem Leseordnungs-Fix zeigten weiterhin transiente Drift; Run `2026-07-27T14-18-37-924Z-b776eb5` endete mit `956.750 sold + 43.374 active = 1.000.124` bei Kapazitaet 1.000.000. Ursache ist ein zweites Fenster: eine neue Reservierung zwischen `ZCARD reservations` und dem spaeteren `GET available` fehlt im Snapshot, ihr `DECR` ist aber bereits sichtbar; die positive Korrektur gibt den weiterhin gehaltenen Anspruch erneut frei. Ein konsistenter Snapshot ueber zwei unabhaengig mutierende Systeme existiert nicht.
- **Entscheidung:**
  1. **Redis ist waehrend eines laufenden Sales die einzige Inventarautoritaet.** `available` wird ausschliesslich durch die atomaren Reserve-, Cancel-/Rollback- und Worker-Kompensationsskripte veraendert. Erfolgreiche Finalisierung entfernt den Ledger-Anspruch, erhoeht `available` aber nicht.
  2. **Der schreibende Reconcile entfaellt vollstaendig.** Kein Startup- oder Periodic-Job leitet `available` aus PostgreSQL ab, initialisiert fehlende Runtime-Keys oder korrigiert Redis per `MSET`/`INCRBY`.
  3. **Inventory Auditor:** Ein periodischer read-only Job misst `capacity`, `available`, `COUNT(tickets)`, aktive und stale Reservierungen sowie das signierte Capacity-Delta. Cross-System-Ausschlaege unter Parallelitaet sind Diagnosewerte; nach abgeschlossenem Drain muss die Invariante exakt aufgehen.
  4. **Sold-count Projector:** Die Materialisierung `COUNT(tickets) → events.sold_count` wird als eigene DB-Projektion beibehalten. Sie fuehrt pro Zyklus nur eine Aggregation aus, teilt den Snapshot mit dem Auditor und schreibt niemals nach Redis. Default ist 60 s; Laufzeit und Pool-Effekt werden gemessen. Da `sold_count` weder Admission noch Korrektheit traegt, darf der Projector im Kapazitaetsprofil pausieren und nach dem Drain laufen, falls ein Messbeleg relevante I/O-Interferenz zeigt.
  5. **Capacity-Invariante als Quality Gate:** Nach Drain gilt `available + dbTickets + activeReservations == totalCapacity`. Eine Verletzung setzt den Lasttest auf `system=fail`; fehlende Operanden ergeben `inconclusive`.
  6. **Reaper statt Summenkorrektur:** Verwaiste Ansprueche werden identitaetsbasiert per `orderId` freigegeben. Der erste Scope darf ausschliesslich eine abgelaufene Reservation im Zustand `pending` atomar per `ZREM + INCR` freigeben. `POST /pay` claimt deshalb vor dem Publish atomar `pending → publishing`; `publishing|paid` wird nie allein wegen Alter freigegeben.
  7. **Deadline statt TTL als fachliche Entscheidung:** Der ZSet-Score traegt die millisekundengenaue Eligibility Deadline. Der Reaper gibt nie vorher und im naechsten Lauf danach frei. Redis-TTL bleibt nur Cleanup-Mechanismus fuer Read-Models: Expiry ist kein exakter Trigger, kann keine Cross-Key-Kompensation ausfuehren und beweist keinen fachlich abgebrochenen Checkout. Der Pending-State muss bis zur Reaper-Entscheidung erhalten bleiben.
  8. **Observability:** Das bestehende Dashboard `Reservation & Consistency` wird zu `Inventory Integrity` und zeigt Capacity-Komponenten/-Delta, Auditor-Health, Ledger active/stale, Reaper-Aktivitaet und den aeltesten Pending-Anspruch. Das Dashboard `DB & Runtime` zeigt Projector-Latenz, Fehler, letzten Erfolg und Pool-Wait.
  9. **Lokale Initialisierung:** Der Spike-Test setzt PostgreSQL, Redis und Pub/Sub weiterhin vor dem Verkauf ueber Reset/Seed auf einen definierten Zustand. Fehlende Inventar-Keys waehrend der Runtime sind ein Audit-Fehler, kein Anlass zur Rekonstruktion.
- **Begruendung:**
  - Ein Controller kann nur dann sicher korrigieren, wenn er einen autoritativen Desired State besitzt. `capacity - DB.sold - Redis.active` ist unter Live-Traffic kein atomarer Desired State, sondern eine Mischung verschiedener Zeitpunkte.
  - Die normalen Inventaruebergaenge sind bereits innerhalb von Redis atomar. Ein weiterer schreibender Pfad erweitert die Menge moeglicher Interleavings und hat in drei Lasttests keinen belegten Fehler repariert, aber zweimal zusaetzliche Ansprueche erzeugt.
  - Ein Reaper kann anhand einer konkreten `orderId` zwischen `pending`, `publishing`, verkauft und bereits freigegeben unterscheiden. Eine Summenkorrektur kann das nicht.
  - `COUNT(tickets)` als periodische Projektion vermeidet den frueheren Hot-Row-Update pro Ticket. Ein Scan pro 60 s kann dennoch lokale I/O verbrauchen und wird deshalb instrumentiert, nie verdoppelt und nicht zur Admission-Voraussetzung gemacht.
- **Alternativen (verworfen):**
  - **Reconcile nur konservativ nach unten schreiben:** verhindert Oversell, laesst aber weiterhin einen nicht atomaren Beobachter das Inventar veraendern und kann unter Last kuenstlichen Undersell erzeugen. Als Notbremse vertretbar, nicht als Zielarchitektur.
  - **Cross-System-Reconcile mit anderer Leseordnung:** ADR-022 reparierte damit nur den Finalisierungs-Race; neue Reservierungen zwischen Ledger- und Counter-Read bleiben ein Gegenbeispiel.
  - **Redis-TTL gibt Inventar automatisch frei:** TTL entfernt einen Key, aber nicht atomar Ledger-Anspruch und Counter; zudem kann eine bezahlte oder gerade publizierte Order nur aufgrund ihres Alters freigegeben werden.
  - **`sold_count` wieder pro Ticket in PostgreSQL inkrementieren:** stellt die Hot-Row-Serialisierung aus ADR-011 wieder her.
  - **Reconcile-HA per Kubernetes Lease oder separatem Service:** macht einen fachlich unsicheren Algorithmus nur hochverfuegbar. Mit Wegfall des schreibenden Loops ist keine Leader Election fuer Auditor oder Projector korrektheitsrelevant.
- **Bewusst ausserhalb des Scopes:** Redis-HA, Persistenz und Wiederherstellung nach vollstaendigem Redis-Datenverlust; DLQ-/Outbox-Recovery fuer unklare `publishing`-Zustaende; Cloud-Deployment. Diese Phase nimmt einen durch Seed korrekt initialisierten Redis-Zustand an.
- **Umsetzungsplan:** `docs/TODO.md` Phase 4.9; Detailplan und Dashboard-Zuordnung in `docs/notes/phases/phase-4-9-inventory-integrity.md`.

## Nachtrag 2026-08-16: Ablauf wird sichtbar und im Pay-Pfad durchgesetzt

Ziffer 6 und 7 bleiben unveraendert gueltig: die Freigabe ist weiterhin
identitaetsbasiert (`ZREM` + `INCR`), der ZSet-Score bleibt die Autoritaet fuer
die Faelligkeit, und `publishing|paid` werden nie altersbedingt freigegeben.

Praezisiert wird zweierlei. Der Reaper loescht den Order-Record nicht mehr
ersatzlos, sondern hinterlaesst einen terminalen `expired`-Grabstein mit der
Cleanup-TTL finaler Orders. Und `POST /pay` setzt die Deadline jetzt hart durch,
statt sie zu ignorieren — mit derselben Grenze, die auch der Reaper anlegt.
Beides steht in
[ADR-033](ADR-033-abgelaufener-checkout-ist-ein-eigener-endzustand.md).

## Nachtrag 2026-07-30: umgesetzt

Die Entscheidungen 1–9 sind implementiert und durch Unit-, Integrations-,
Redis-Race- und E2E-Tests abgesichert. Der schreibende Reconcile, sein
Startup-Blocker, sein Scheduler und die `WORKER_RECONCILE_*`-Konfiguration
existieren nicht mehr; ADR-022 ist damit abgelöst. Auditor, Sold-count Projector
und Pending-Reaper teilen einen `COUNT(tickets)`-Snapshot pro Zyklus, der
Subscriber startet unabhängig von ihnen. Der Ist-Zustand steht in
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md#inventory-wartung).

Offen bleibt allein der Nachweis unter Last: der Abschluss-Lasttest und die
Messung des Projector-Einflusses auf den Pool-Wait sind in `docs/TODO.md`
Phase 4.9 als eigene Todos geführt.
