# Analyse: Standard-Flow (Ticket-Kauf) — Vereinfachung & Performance

Stand: 2026-07-03 · Scope: `POST /buy` → Pub/Sub → Worker → Redis/PostgreSQL → `GET /orders/:orderId`

Methodischer Rahmen (nach Casey Muratori, "Clean Code, Horrible Performance" / "Simple Code, High Performance"):

1. **Zähle, was pro Operation tatsächlich passiert** (Netzwerk-Roundtrips, Locks, Allokationen) statt nur Code-Struktur zu bewerten.
2. **Back-of-the-envelope zuerst:** Was ist die theoretische Obergrenze, und welcher Teil des Codes liegt am weitesten darunter?
3. **Indirektion nur, wenn sie etwas kauft.** Callback-Injection, strukturelle Typ-Schatten und Laufzeit-Validierung eigener Konstanten sind Kosten ohne Gegenwert.
4. **Tabellen statt verstreuter Branches:** Entscheidungslogik (ACK/NACK, Metriken) als Daten abbilden, nicht als verschachtelte try/catch-Pfade.

Alle Vorschläge respektieren die Projekt-Learnings: **Async Writes über Pub/Sub bleiben**, **Reads bleiben ausschließlich Redis**, Fastify, Zod-inferierte DTOs und die dokumentierten ACK/NACK-Semantiken bleiben erhalten. Wo ein Vorschlag ein ADR berührt, ist das explizit markiert.

---

## 1. Ist-Zustand: Was kostet ein Ticket-Kauf wirklich?

Die fachliche Arbeit pro Kauf ist winzig: ein Zähler-Decrement, ein Ticket-Row-Append, ein Status-Write — Mikrosekunden an CPU. Der Flow bezahlt dafür aktuell:

| Schritt              | Ort                                       | Operationen                             | Roundtrips       |
| -------------------- | ----------------------------------------- | --------------------------------------- | ---------------- |
| Reserve (Lua `EVAL`) | API `buy.ts:116`                          | GET+DECR atomar                         | 1 × Redis        |
| Reservation-Key      | API `buy.ts:141`                          | `SET EX`                                | 1 × Redis        |
| Pending-Order-Key    | API `buy.ts:142`                          | `SET EX`                                | 1 × Redis        |
| Publish              | API                                       | Pub/Sub (Client-seitig gebatcht)        | ~0 (amortisiert) |
| Idempotenz-Check     | Worker `pubsub-listener.ts:166`           | `GET processed`                         | 1 × Redis        |
| Processing-Lock      | Worker `pubsub-listener.ts:170`           | `SET NX EX`                             | 1 × Redis        |
| Payment-Mock         | Worker `handle-buy-ticket-message.ts:139` | `sleep(1000)`                           | —                |
| DB-Write             | Worker                                    | `SELECT buy_ticket(...)` (4 Statements) | 1 × PostgreSQL   |
| Order-Cache final    | Worker                                    | `SET EX`                                | 1 × Redis        |
| Processed-Marker     | Worker                                    | `SET EX`                                | 1 × Redis        |
| Lock-Release         | Worker                                    | `DEL`                                   | 1 × Redis        |

**Summe: 8 sequenzielle Redis-Roundtrips + 1 DB-Transaktion pro Ticket.** Alle `await`s stehen hintereinander; nichts läuft parallel, nichts ist gepipelined. Bei 0,5 ms RTT sind das ~4 ms reine Netzwerk-Wartezeit pro Ticket — pro Instanz multipliziert mit der Concurrency, auf Redis-Seite multipliziert mit der Gesamtlast (bei 2.000 Käufen/s: **16.000 Redis-Ops/s nur für den Kauf-Flow**, erreichbar wären 3–4/Kauf, siehe §4).

Back-of-envelope fürs Lastziel: 1 Mio. Tickets in ~8 Minuten Peak ≈ **~2.100 abgeschlossene Käufe/s**. Daran müssen sich drei Engpässe messen lassen: die `events.sold_count`-Row-Lock-Serialisierung (§6), die Pub/Sub-Flow-Control × 1 s Sleep (§5) und der Reconcile-SCAN (§7).

---

## 2. Befund A — Strukturelle Typ-Schatten & Casts (nur Vereinfachung)

`@fastify/redis` und die eigenen Pub/Sub-Plugins deklarieren `fastify.redis` / `fastify.pubsubPublisher` bereits typsicher via Module Augmentation. Trotzdem definieren vier Dateien eigene strukturelle Redis-Interfaces und casten die Instanz:

- `apps/api/src/routes/api/tickets/buy.ts:33-51` (`TicketRedisClient`, `TicketPublisher`) + Cast in `buy.ts:192`
- `apps/api/src/routes/api/orders/status.ts:13-15` + Cast in `status.ts:32`
- `apps/worker/src/routes/pubsub-listener.ts:39-62` (`TicketRedisClient`, 24 Zeilen) + Cast in `pubsub-listener.ts:127`
- `apps/worker/src/lib/reconcile-ticket-availability.ts:6-16` (`ReconcileRedisClient`)

Das ist das "hide internal data structures"-Muster aus dem Video: Jede Datei baut sich eine private Sicht auf denselben ioredis-Client, und jede Sicht muss bei jeder Redis-API-Nutzung nachgezogen werden (der `eval`/`scan`/`mset`-Signatur-Nachbau ist bereits jetzt fehleranfällig gedriftet). **Empfehlung:** Die ioredis-Typen aus `@fastify/redis` direkt verwenden; für die zwei Stellen, die testhalber ein schmales Interface brauchen, genügt `Pick<Redis, "get" | "set" | ...>` an einer zentralen Stelle (z. B. `packages/types`). Spart ~70 Zeilen und alle Casts, null Laufzeit-Risiko.

## 3. Befund B — Zod-Parse auf selbst konstruierten Literalen (Hot Path)

Zod ist laut Learning für DTO-Grenzen da (externer Input). Der Code validiert aber auch Objekte, die er zwei Zeilen vorher selbst als Literal gebaut hat — pro Request/Message:

- API: `pendingOrderCacheEntrySchema.parse({...})` in `buy.ts:133`
- Worker: `orderCacheEntrySchema.parse(entry)` in `pubsub-listener.ts:96` **zusätzlich** zu `completedOrderCacheEntrySchema.parse({...})` / `failedOrderCacheEntrySchema.parse({...})` in `handle-buy-ticket-message.ts:143,185` — dieselben Daten werden auf dem Erfolgspfad **doppelt** durch Zod geschickt.

TypeScript garantiert die Struktur zur Compile-Zeit bereits vollständig. **Empfehlung:** Beim Konstruieren `satisfies CompletedOrderCacheEntry` statt Laufzeit-`parse`; Zod-Parse nur an den echten Grenzen behalten (HTTP-Request-Validation, Pub/Sub-Payload in `handleBuyTicketMessage`, Lesen fremder Redis-Werte in `status.ts`). Das Learning "Zod für DTOs" bleibt vollständig intakt — es geht nur der redundante Parse eigener Konstanten weg.

## 4. Befund C — Sequenzielle Redis-Roundtrips statt Scripts/Pipelines

### API (`queueBuyTicketPurchase`)

Drei sequenzielle Roundtrips (EVAL, SET, SET), obwohl:

1. Die beiden `SET`s voneinander unabhängig sind (mindestens `Promise.all` → 2 RTT).
2. Alles in **ein** Lua-Script passt: check+DECR `available`, `SET` Reservation, `SET` Pending-Order → **1 RTT**, und der Rollback-Fall "Reservation gesetzt, Pending-Write fehlgeschlagen" verschwindet als eigener Fehlerpfad — das Script ist atomar. Der Rollback in `buy.ts:65-101` (37 Zeilen, drei einzelne try/catch) schrumpft auf den einzigen verbleibenden Fall "Publish fehlgeschlagen" mit einem Gegen-Script (DEL+INCR+DEL, ebenfalls 1 RTT).
3. `redis.eval(...)` überträgt den Script-Text bei **jedem Request**. ioredis' `defineCommand` nutzt `EVALSHA` mit automatischem Fallback — Script einmal registrieren, danach nur noch der Hash über die Leitung.

Cluster-Caveat: `tickets:event:…` und `orders:…` liegen in Redis Cluster in verschiedenen Hash-Slots. Memorystore Standard ist nicht geclustert, das Script ist heute also zulässig; falls Cluster je ein Thema wird, Hash-Tags (`orders:{<eventId>}:…`) einplanen und im ADR festhalten.

### Worker (Erfolgspfad)

- `isOrderProcessed` (GET) + `tryAcquireProcessingLock` (SET NX) → ein Script bzw. sogar **ein einziger Key** (siehe §5, Zustand statt zwei Key-Familien): 2 RTT → 1 RTT.
- `writeOrderCacheEntry` + `markOrderProcessed` + `releaseProcessingLock` → eine Pipeline/ein Script: 3 RTT → 1 RTT.

**Netto: 8 Redis-RTT/Kauf → 3.** Gleichzeitig wird der Code _einfacher_, nicht komplexer: weniger Zwischenzustände, weniger Fehlerpfade, weniger zu testende Interleavings.

## 5. Befund D — Der Worker-Handler: Komplexität, die eine vorhandene Garantie dupliziert

`handle-buy-ticket-message.ts` (280 Zeilen) + Verdrahtung in `pubsub-listener.ts:130-202` (70 Zeilen) sind der Teil, der "zu kompliziert zu erfassen" ist. Die Komplexität hat drei Quellen:

### D1. Die DB-Funktion ist bereits idempotent — Lock & Marker sichern nichts Zusätzliches

`buy_ticket` (Migration `0008`) macht `INSERT INTO orders … ON CONFLICT (id) DO NOTHING` und gibt bei Konflikt das existierende Ticket zurück. Die gesamte Funktion ist **eine** Transaktion. Damit gilt:

- **Redelivery nach Erfolg:** zweiter Aufruf trifft den Conflict, kein doppelter `sold_count`, existierendes Ticket kommt zurück. ✔
- **Parallele Doppel-Zustellung:** die zweite `INSERT` wartet auf die Row-Lock der ersten und läuft dann in den Conflict-Pfad. ✔
- **Kompensation bei P0001:** das Release-Script (`DEL`→nur bei 1 `INCR`) ist selbst idempotent. ✔

Der Redis-`processed`-Marker und der `processing`-Lock (zwei Key-Familien, 3 RTT, TTL-Tuning, der Lock-Conflict-NACK-Pfad, der "markOrderProcessed fehlgeschlagen → NACK"-Pfad samt Tests) implementieren also eine Garantie **nochmal**, die die stärkste Schicht (die DB-Transaktion) schon gibt. Das ist der "blind code reuse"-Punkt aus dem Witness-Vortrag, nur invertiert: hier wird nicht blind wiederverwendet, sondern blind dupliziert.

**Empfehlung (gestuft, ADR-004-Update erforderlich — das Learning "Idempotenz via orderId" wird nicht verletzt, sondern in die DB-Schicht verlagert, wo sie längst implementiert ist):**

- _Minimalvariante:_ `processed`-Marker als reine Redis-Optimierung behalten (spart bei Redelivery den 1-s-Sleep + DB-Roundtrip), aber den **`processing`-Lock streichen**. Sein einziger Effekt heute ist, dass parallele Doppel-Zustellungen sofort genackt werden und heiß rotieren, statt harmlos in den DB-Conflict-Pfad zu laufen. Entfällt: Lock-Key-Familie, `tryAcquireProcessingLock`, `releaseProcessingLock`, das `finally` mit eigenem Fehler-Logging, der Lock-Conflict-NACK-Zweig, zwei Metriken, mehrere Tests.
- _Konsequente Variante:_ auch den `processed`-Marker streichen und Redelivery einfach erneut durch `buy_ticket` laufen lassen (Conflict-Pfad ist ein billiger Index-Lookup). Redeliveries sind selten; eine 86.400-s-Key-Familie mit 1 Mio. Einträgen (relevant für §7!) nur dafür zu unterhalten ist die teurere Lösung.

### D2. Ausgang als verstreute Branches statt als Tabelle

Der Handler hat sechs Exit-Pfade, die jeweils selbst `ack()`/`nack()` aufrufen, selbst loggen und selbst 1–3 Metrik-Callbacks feuern. Die ACK/NACK-Regeln existieren als Doku-Tabelle in `ARCHITECTURE.md` — im Code sind sie über 200 Zeilen verteilt. **Empfehlung (Muratoris Switch/Tabellen-Punkt):** Der Handler berechnet nur noch ein _Ergebnis_ und fasst nichts an:

```ts
type Outcome =
  | { kind: "completed"; eventId: string; queuedAt: number }
  | { kind: "duplicate"; eventId: string }
  | { kind: "invalid-payload" }
  | { kind: "terminal-failed"; eventId: string; queuedAt: number }
  | { kind: "compensation-failed"; eventId: string }
  | { kind: "transient-error"; eventId: string };
```

Eine einzige Stelle (im Listener) mappt `Outcome.kind` → `{ ack: boolean, counters: […], logLevel }` — die Doku-Tabelle wird wörtlich zu Code. Der Handler wird linear lesbar, ack/nack ist beweisbar genau einmal pro Nachricht, und neue Fälle sind eine Tabellenzeile statt eines neuen try/catch-Astes.

### D3. Callback-Injection ohne Gegenwert

`BuyTicketMessageHandlerDeps` injiziert 9 Funktionen + 7 optionale Metrik-Callbacks; der Listener verdrahtet sie über 70 Zeilen mit Inline-Closures. Die Metriken sind Modul-Level-Prometheus-Counter — die Indirektion existiert nur, damit Tests Aufrufe zählen können, was mit `prom-client`-Registern oder dem Outcome-Wert aus D2 genauso geht (Outcome zurückgeben → Test prüft den Wert, fertig; kein Mock-Geflecht). Mit D1+D2 schrumpfen die Deps auf ~4 echte Abhängigkeiten (`executeBuyTicket`, `compensateReservation`, `writeOrderCacheEntry`, `sleep`). Realistisch: **~350 Zeilen → ~130**, bei identischem Verhalten laut ACK/NACK-Tabelle.

### D4. Randnotiz Failed-Pfad

`markOrderFailed` (UPDATE) trifft im einzigen heutigen Terminal-Fall (P0001 = Event nicht gefunden) nie eine Zeile: Die Order-INSERT ist Teil derselben abgebrochenen Transaktion, die Funktion liefert immer `"missing"`. Failed-Orders existieren daher nur in Redis (TTL 24 h), nie in PostgreSQL. Entweder als Upsert persistieren oder den DB-Write im Failed-Pfad streichen — der jetzige Zustand ist Code für einen Fall, der nicht eintreten kann.

## 6. Befund E — PostgreSQL: Hot-Row-Serialisierung und Dead Tuples

`buy_ticket` führt pro Kauf 4 Statements aus, davon zwei mit strukturellen Kosten:

1. **`UPDATE events SET sold_count = sold_count + 1`** — jede der ~2.100 Transaktionen/s nimmt die Row-Lock **derselben** Event-Zeile und hält sie über Ticket-INSERT + Order-UPDATE + Commit. Bei ~2 ms Restlaufzeit nach dem Update ist die theoretische Decke ~500 Käufe/s pro Event — **ein Viertel des Lastziels**, unabhängig davon, wie viele Worker skaliert werden. Das ist der klassische Single-Row-Hotspot.
   - _Günstigster Fix:_ Prüfen, wer `sold_count` konsumiert — heute ausschließlich der Reconcile (`listEventInventorySnapshots`). Dann kann das Hot-Path-UPDATE komplett entfallen und der Reconcile rechnet `SELECT event_id, count(*) FROM tickets GROUP BY event_id` (Index auf `event_id` existiert via FK-Nutzung ohnehin; alle 10–60 s ein Aggregat ist billig). Die Event-Existenz-Prüfung, die das UPDATE nebenbei erledigt, liefert die Ticket-FK-Violation genauso — dasselbe Mapping auf P0001, das die Funktion für Orders schon hat.
   - _Alternativen, falls `sold_count` bleiben soll:_ Update ans Transaktionsende ziehen (Lock-Haltezeit minimieren) oder Batch-Aggregation (§ unten).
2. **`INSERT orders … 'pending'` gefolgt von `UPDATE orders … 'completed'`** in derselben Transaktion erzeugt pro Kauf ein Dead Tuple — bei 1 Mio. Käufen 1 Mio. tote Zeilenversionen + Autovacuum-Druck mitten im Peak. Der Zwischenzustand `pending` ist außerhalb der Transaktion nie sichtbar. **Fix:** Order direkt als `'completed'` am Ende einfügen (`ON CONFLICT DO NOTHING` bleibt der Duplikat-Anker). 4 Statements → 3, keine Dead Tuples.

**Der größte unerschlossene Hebel (bewusst als Ausbaustufe):** Der Worker verarbeitet strikt 1 Nachricht = 1 Transaktion. Ein Batch-Modus (N Nachrichten sammeln → ein Multi-Row-INSERT + ein `sold_count += N`) amortisiert Commit- und Statement-Overhead um den Faktor N und ist die kanonische Antwort auf Durchsatz-Ziele dieser Größenordnung. Das ist ein eigenes Arbeitspaket (ACK-Semantik pro Batch-Element, neues ADR) — hier nur als Richtung notiert.

## 7. Befund F — Reconcile: SCAN über den gesamten Keyspace (Skalierungs-Landmine)

`countActiveReservations` zählt aktive Reservierungen per `SCAN MATCH tickets:event:<id>:reservation:*`. **SCAN mit MATCH iteriert immer den gesamten Keyspace** und filtert erst danach. Back-of-envelope für den Peak:

- Keyspace nach 1 Mio. Verkäufen: ~1 Mio. `orders:*` (TTL 24 h) + ~1 Mio. `processed`-Marker (TTL 24 h) ≈ **2 Mio. Keys**.
- `COUNT 100` → ~20.000 Roundtrips pro Reconcile-Lauf **pro Event**; bei 0,3–0,5 ms RTT sind das 6–10 s — der Peak-Modus (10-s-Intervall) reconciled dann praktisch pausenlos und verbrennt Redis-CPU fürs Durchkämmen von Keys, von denen >99 % nie matchen können.

**Empfehlung:** Reservierungen zusätzlich in ein Sorted Set pro Event schreiben (`ZADD reservations:<eventId> <expiresAt> <orderId>` im Reserve-Script aus §4, `ZREM` im Release-Script):

- Zählen: `ZCOUNT key <now> +inf` — **1 Roundtrip, O(log n)** statt 20.000 Roundtrips.
- Abgelaufene Einträge: `ZRANGEBYSCORE`/`ZREMRANGEBYSCORE` liefert sie **explizit** — abgelaufene Reservierungen können deterministisch zurückgebucht werden (`INCRBY available N`), statt als Drift zu leaken, den der Reconcile später glattbügelt. Die Drift-Metrik (ADR-023) bleibt als Nebenprodukt erhalten, wird aber strukturell kleiner.
- Die per-Order-Reservation-Keys mit TTL können mittelfristig entfallen (das ZSet trägt dieselbe Information inkl. Ablauf); übergangsweise können beide parallel laufen.

Zweiter Punkt: `reconcileTicketAvailability` schreibt `available` per `MSET` **unbedingt** zurück. Zwischen SCAN-Snapshot und MSET reservierte Käufe werden überschrieben (verlorene Decrements → kurzzeitige Überverkaufs-Fenster bei 50k RPS mit hunderten Requests im Fenster). **Fix:** Korrektur als Delta per Lua (`DECRBY`/`INCRBY` um die gemessene Drift) statt absolutem Überschreiben, und/oder nur korrigieren, wenn `|drift| > Schwellwert`.

## 8. Befund G — Pub/Sub-Plugins: Dev-Bootstrapping im Runtime-Pfad

`apps/api/src/plugins/pubsub.ts` (113 Zeilen) + `apps/worker/src/plugins/pubsub.ts` (217 Zeilen): Die Produktions-Essenz (Client, Topic/Subscription, publish/subscribe, sauberes Close) sind ~40 Zeilen. Der Rest ist:

1. **Exists-Check/Auto-Create-Maschinerie** (Topic _und_ Subscription, gRPC-Code-5/6-Sonderbehandlung, `exists?`-Optionalität): Das ist Emulator-Bootstrapping (`autoCreate ⇐ PUBSUB_EMULATOR_HOST`) und gehört als einmaliges Provisioning in `scripts/local/` bzw. einen Compose-Init-Schritt — nicht in jeden App-Start. In Produktion provisioniert Terraform (ADR-010); die App darf beim ersten Publish/Subscribe hart scheitern. Entfernt ~140 Zeilen inkl. `ensureSubscription` und der dreifach gestaffelten Fallback-Fehlertexte.
2. **`*Like`-Typ-Schatten** (`TopicLike`, `SubscriptionLike`, `PubSubClientLike`, `exists?`/`createSubscription?` optional): existieren nur, damit Tests Fake-Clients ohne die echten Typen bauen können — derselbe Typ-Schatten-Befund wie §2. Mit dem Emulator im Compose-Setup (`hts-pubsub`) können Integrationstests gegen die echte Library laufen; für Unit-Tests genügt ein einziges schmales Interface (`publishBuyTicket` bzw. `onMessage/start/stop`), das es mit `PubSubPublisher`/`PubSubSubscriber` **bereits gibt**.
3. **Zweiphasige Registrierung im Worker** (`onMessage(handler)` dann `start()`): erzeugt den Zustand `messageHandler: MessageHandler | null` samt "Nachricht ohne Handler → nack"-Branch, der nur existiert, weil Registrierung und Start über die Plugin/Route-Grenze getrennt sind. `start(handler)` macht den Zustand und den Branch unmöglich statt unwahrscheinlich.
4. **Fehlende Flow-Control-Konfiguration:** Die Subscription läuft mit Library-Defaults (~1.000 Nachrichten in-flight). Rechnung: 1.000 Handler × (1 s Sleep + ~5 ms DB) ≈ **~1.000 Käufe/s pro Worker als Deckel** — unter dem Lastziel, während gleichzeitig alle 1.000 nach dem Sleep durch den **Default-DB-Pool von 10 Connections** (`drizzle(env.DATABASE_URL)` ohne Pool-Config) gequetscht werden. `flowControl.maxMessages` und Pool-Größe gehören explizit gesetzt und aufeinander abgestimmt (Env-Schema, wie die übrigen Knobs) — sonst ist die effektive Backpressure ein Zufallsprodukt zweier Defaults.

## 9. Priorisierte Empfehlungen

| #   | Maßnahme                                                                                                                            | Wirkung                                                                 | Aufwand | Learnings/ADRs                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------- | -------------------------------------------- |
| 1   | Reserve+Reservation+Pending als **ein** Lua-Script (`defineCommand`), Publish-Rollback als Gegen-Script                             | 3→1 RTT im API-Hot-Path, Rollback-Pfad schrumpft, atomar                | S       | ADR-005-Update (Script erweitert)            |
| 2   | Worker-Erfolgspfad: Cache+Marker+Lock-Release als eine Pipeline; Check+Lock als ein Script                                          | 5→2 RTT pro Message                                                     | S       | —                                            |
| 3   | Handler auf **Outcome-Wert + ACK/NACK-Tabelle** umbauen, Metrik-Callbacks durch Outcome-Mapping ersetzen                            | ~350→~130 Zeilen, Regeln = Doku-Tabelle, testbar ohne Mock-Geflecht     | M       | Verhalten identisch zur ACK/NACK-Tabelle     |
| 4   | `processing`-Lock streichen (Idempotenz trägt die DB-Transaktion, die es schon tut); `processed`-Marker optional behalten           | Key-Familie, NACK-Hot-Loop, 2 Fehlerpfade und Tests entfallen           | M       | **ADR-004-Update** (Idempotenz-Schicht = DB) |
| 5   | Reservierungen ins **ZSet** (Score = Expiry): `ZCOUNT` statt Keyspace-SCAN, abgelaufene Reservierungen deterministisch zurückbuchen | Reconcile O(log n) statt O(Keyspace); beseitigt die 20.000-RTT-Landmine | M       | ADR-022/023-Update                           |
| 6   | Reconcile: Delta-Korrektur (Lua `INCRBY`) statt absolutem `MSET available`                                                          | Schließt das Lost-Decrement-Fenster                                     | S       | —                                            |
| 7   | `buy_ticket`: Order direkt als `completed` einfügen; `sold_count`-Hot-Row-UPDATE entfernen und im Reconcile aggregieren             | Beseitigt Row-Lock-Decke (~500/s) und 1 Mio. Dead Tuples                | M       | ADR-011-Update                               |
| 8   | `flowControl.maxMessages` + DB-Pool-Größe explizit konfigurieren (Env-Schema)                                                       | Deterministische Backpressure, Deckel ans Lastziel anpassbar            | S       | —                                            |
| 9   | Topic/Subscription-Provisioning nach `scripts/local/` verschieben; `*Like`-Typen und Zweiphasen-Start entfernen                     | ~200 Zeilen weniger Plugin-Code, ein Zustandsautomat weniger            | M       | —                                            |
| 10  | Zod-Parse eigener Literale durch `satisfies` ersetzen; Redis-Typ-Schatten/Casts durch Plugin-Typen ersetzen                         | Weniger Hot-Path-CPU, ~100 Zeilen weniger, Drift-Risiko weg             | S       | Zod bleibt an allen externen Grenzen         |
| —   | _Ausbaustufe:_ Batch-Verarbeitung im Worker (N Messages → 1 Transaktion)                                                            | Der große Durchsatz-Hebel Richtung 2.000+/s                             | L       | Neues ADR nötig                              |

**Reihenfolge-Logik:** 1, 2, 6, 8, 10 sind risikoarm und sofort machbar. 3+4 zusammen sind der eigentliche "Pub/Sub-Handler verständlich machen"-Block. 5 und 7 sind die beiden Befunde, die unter Peak-Last _korrektheits- bzw. kapazitätsrelevant_ werden — sie sollten vor dem nächsten großen Lasttest passieren.

## 10. Was bewusst NICHT verändert wird

- **Async Writes über Pub/Sub** und **Reads nur aus Redis** — alle Vorschläge arbeiten innerhalb dieser Architektur.
- Die dokumentierte **ACK/NACK-Semantik** — §5/D2 kodiert sie nur als Tabelle; einziger semantischer Wegfall ist der Lock-Conflict-NACK, dessen Fall (parallele Doppel-Zustellung) dann von der DB-Transaktion abgedeckt wird (ADR-Update, kein stiller Bruch).
- Der **1-s-Payment-Mock** (ADR-013) — er ist Absicht; relevant ist nur, dass Flow-Control ihn einpreist (§8.4).
- **Reconcile-Loop als Singleton** (ADR-022) und die **Drift-Metrik** (ADR-023) — sie werden effizienter, nicht abgeschafft.
- Polling statt SSE (ADR-017), Zod an externen Grenzen (ADR-008), Fastify-Plugin-Architektur.
