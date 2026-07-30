# P2 — Dashboard-Audit (Baseline C)

Abgeschlossene Detailnotiz zum Audit aller Grafana-Dashboards nach Baseline C.

## Dashboard-Audit: Vorspann

> Leitfehler: mehrere Panels behandeln `orders_accepted_total` als „publiziert". Seit ADR-028 wird bei `/buy` nur reserviert und erst bei `/pay` publiziert — dieselbe Verwechslung, die in der Drain-Formel bereits behoben wurde. Mit ~12 % Abbrechern ist die Luecke strukturell und schliesst sich nie.

## order-lifecycle: Pending, Ratio und Cumulative Counts

> - [x] **`order-lifecycle`:** „Pending Orders (accepted − completed − failed)" ueberschaetzt den Rueckstand um die Abbrecher (Peak 118 K war teils nur Abandonment) → auf `payments_confirmed_total` umstellen. „Worker/API Throughput Ratio" und „Failure Rate" nutzen `accepted` als Nenner → kann 100 % nie sauber treffen (zeigte 107 %). „Cumulative Order Counts" vergleicht Accepted mit Completed, die sich deshalb **nie treffen koennen** (1,09 Mio vs 963 K = genau `cancelled + abandoned`) → `payments_confirmed` als dritte Linie ergaenzen oder gegen Published vergleichen. — Umgesetzt: alle vier Panels auf `payments_confirmed_total` als Bezugsgroesse umgestellt (Pending, Throughput-Ratio, Failure-Rate-Nenner), „Cumulative Counts" um die Linie „Total Paid (published)" ergaenzt (macht sichtbar, dass Accepted−Paid = Abbrecher), Order-Throughput-Panel um `paid / s` erweitert. **Zusaetzlich beim Live-Testen gefunden:** die Fenster-Differenz kann im Drain negativ werden (Completions alter Zahlungen > neue Zahlungen im 5m-Fenster; gemessen −1.686) → `clamp_min(…, 0)`.

## order-lifecycle: Checkout Abandon Rate negativ

> - [x] **`order-lifecycle`: „Checkout Abandon Rate" lieferte −7,33 %** — ein negativer Abbruchanteil ist unmoeglich. Ursache: `1 − paid/reserved` ueber ein 5-Minuten-Fenster; am Ende des Verkaufs liefert `/buy` nur noch `409` (reserved stagniert), waehrend Zahlungen aus frueheren Reservierungen noch eintreffen ⇒ `paid > reserved` im Fenster. Der korrekte Wert ueber den ganzen Lauf ist **+11,95 %**. Fix: `$__range` statt `[5m]`, zusaetzlich bei 0 klemmen. — Umgesetzt: `$__range` statt `[5m]` plus `clamp_min(…, 0)`. Live gegen die Baseline-C-Daten verifiziert: **12,1 %** statt −7,33 % (modelliert waren 12 %).

## pubsub-queue: Publish Rate und Queue Depth

> - [x] **`pubsub-queue`:** „Publish Rate (API accepted)" ist woertlich falsch beschriftet — `accepted` ist die Reserve-Zahl, nicht die Publish-Zahl → auf `payments_confirmed_total` umstellen. „Queue Depth (approx, 2m)" hat dieselbe Ursache und ueberschaetzt die Tiefe. Ausserdem fehlt `worker_duplicate_deliveries_total` (Redeliveries, die per ON CONFLICT absorbiert wurden und **keine** NACKs sind — der vorhandene „Redelivery Rate (NACK backlog)"-Graph sieht sie nicht). — Umgesetzt: Publish-Rate und Queue-Depth auf `payments_confirmed_total`, Legenden korrigiert („Publish Rate (payments confirmed)", „Enqueue Rate (published / s)"), `worker_duplicate_deliveries_total` als eigene Serie ergaenzt, Queue-Depth mit `clamp_min` gegen negative Fenster-Differenzen.

## api-performance: eigene Panels fuer pay und cancel

> - [x] **`api-performance`: `/pay` und `/cancel` haben keine eigenen Panels**, obwohl beide Routen Metriken liefern (`route="/api/orders/:orderId/pay"` und `…/cancel` sind im Snapshot vorhanden). Seit ADR-028 ist `/pay` der Schreibpfad, der publiziert — er gehoert neben `/buy` in „Request Rate" und braucht ein eigenes Latenz-Panel. Nur „Latency by Route" faengt sie generisch mit ab. `GET /api/orders/:orderId` ebenfalls ergaenzen (im Lauf nicht exerziert, weil `CHECKOUT_POLL=false`). — Umgesetzt: `POST /pay RPS` + `POST /cancel RPS` im Request-Rate-Panel, neues Panel „POST /pay Latency (p50/p95/p99)" (volle Breite unten). Live-Check gegen Baseline-C-Daten: Pay-p95 im Crunch **4,55 s** — deutlich ueber Buy (874 ms), der Publish-Pfad ist unter Last der langsamste Schritt; genau das war vorher unsichtbar. `GET /orders/:orderId` bewusst weggelassen, solange `CHECKOUT_POLL=false` (kein Traffic, leeres Panel); „Latency by Route" faengt es generisch ab.

## api-performance: Error Rate ignoriert 425

> - [x] **`api-performance`: „Error Rate (5xx + Sold Out 409)" ignoriert `425`** (Too Early, ADR-024) — im Warm-up sind das alle Kaufversuche (29.965 im Lauf), sie tauchen nirgends auf. Zudem ist die Beschriftung „Sold Out 409" ungenau: seit ADR-028 liefern auch `/pay` und `/cancel` ein `409` (bereits finalisierte Order) und ein `404` (fehlende Reservierung). Nach `route` aufschluesseln statt global mischen. — Umgesetzt: `425 Too Early Rate` als Serie ergaenzt, Titel „Error Rate (5xx / 409 / 425)", Beschreibung erklaert die 409-Mehrdeutigkeit (Sold-Out bei buy vs. bereits finalisiert bei pay/cancel). Auf die Route-Aufschluesselung verzichtet (mehr Serien als Erkenntnis bei einem Event); via `route`-Label jederzeit ad hoc moeglich.

## reservation-consistency: Current Drift mit Vorzeichen

> - [x] **`reservation-consistency`: „Current Drift (absolute)" nutzt `abs()`** und verwirft damit das Vorzeichen — dabei ist genau das die Information: negativ = konservativ (zu wenig Inventar), positiv = **Ueberzeichnung**. Ohne Vorzeichen ist der Gauge fuer die Oversell-Frage wertlos. — Umgesetzt: `abs()` entfernt, Titel „Current Drift (signiert: + = Überzeichnung)".

## reservation_ledger_active und \_stale ohne Panel

> - [x] **`reservation_ledger_active` und `reservation_ledger_stale` werden nirgends angezeigt.** Beide Gauges existieren und lieferten im Lauf echte Werte (43.336 aktiv, 0 stale), erscheinen aber in keinem der 8 Dashboards. `reservation_ledger_stale` ist das Reaper-Signal aus ADR-026/027 — ohne Panel ist der Phantom-Bestand unsichtbar, obwohl er hier 4,3 % des Inventars band. — Umgesetzt: neues Panel „Reservation Ledger (active / stale)" in `reservation-consistency` (volle Breite unten). Live verifiziert: liefert echte Werte (active 40.253 zum Testzeitpunkt mitten im Lauf).

## worker-reliability: Duplicate Deliveries und Nenner

> - [x] **`worker-reliability`:** `worker_duplicate_deliveries_total` fehlt komplett (neuer Counter). „Redelivery & Compensation Rate (vs. accepted orders)" nutzt erneut `accepted` als Nenner statt `payments_confirmed`. — Umgesetzt: `worker_duplicate_deliveries_total` in allen drei Ereignis-Panels (Rate, 5m-Counts, Cumulative), Rate-Nenner auf `payments_confirmed_total`, Titel „(vs. published orders)".

## order-completion-latency: Panel-Titel seit ADR-028 falsch

> - [x] **`order-completion-latency`: Panel-Titel ist seit ADR-028 falsch** — „POST /buy → completed | failed" suggeriert, die Messung beginne beim Reservieren. `queuedAt` wird seit dem Split beim **Publish** in der Pay-Route gesetzt, gemessen wird also Publish→Persist. Der Titel laedt dazu ein, Checkout-Denkzeit in die Zahl hineinzulesen. — Umgesetzt: Titel „Order Completion Latency — Publish (POST /pay) → completed | failed", Beschreibung stellt klar, dass Checkout-Denkzeit nicht enthalten ist.

## redis-performance: Memory Usage plottet konstante Null

> - [x] **`redis-performance`: „Memory Usage" plottet `redis_memory_max_bytes`,** das ohne gesetztes `maxmemory` konstant 0 ist und als flache Nulllinie wie ein Defekt aussieht. Entweder ausblenden oder `maxmemory` konfigurieren — Letzteres ist ohnehin sinnvoll, der Lauf belegte 526 MiB ungedeckelt. Die Queries filtern zudem nicht nach `job`. — Umgesetzt: die konstant-0-Serie entfernt. **Bewusst KEIN `maxmemory` gesetzt:** jede Eviction-Policy wuerde Order-/Ledger-Keys stillschweigend verwerfen — fuer diesen Datenbestand ist OOM-lautes-Scheitern dem leisen Datenverlust vorzuziehen; Kapazitaet gehoert stattdessen ins Storage-Review (Phase 6). Panel-Beschreibung dokumentiert das. `job`-Filter nicht ergaenzt (eine Redis-Instanz, kein Kollisionsrisiko).

## db-runtime: Pool Wait und Lock Waits als Momentaufnahme

> - [x] **`db-runtime`: „Pool Wait"/„Lock Waits" sind Momentaufnahmen** und zeigten nach dem Lauf 0, waehrend der Graph 1.070 wartende Acquirer als Maximum auswies. Fuer die Nachbetrachtung eines Laufs ist `max_over_time(…[$__range])` aussagekraeftiger als der Istwert. (Fachlich korrekt, nur irrefuehrend beim Draufschauen.) — Umgesetzt: beide Gauges auf `max_over_time(…[$__range])`. Live-Check deckte auf, dass der wahre Baseline-C-Peak **3.578** wartende Acquirer war (Dashboard-Legende zeigte durch Downsampling nur 1.070) — Nachtrag im Baseline-C-Report §7.

## Dashboard-Audit: als korrekt geprueft

> _Als korrekt geprueft und unveraendert: alle Panels in `db-runtime` (ausser dem Gauge-Hinweis oben) inkl. Event-Loop-Lag und Prozess-CPU (Node-Default-Metriken sind vorhanden), `worker-reliability` Ereigniszaehler, `redis-performance` Hit/Miss und Key-Count, `order-lifecycle` „Checkout Funnel" (nutzt korrekt reserved/paid/cancelled) sowie `api-performance` „Latency by Route"._
