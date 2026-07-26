# TODO-Archiv

Wortgleiche Original-Eintraege aus `docs/TODO.md`, die am 2026-07-26 gekuerzt wurden
(siehe ADR-029). Ein reines Archiv: hier wird nichts umgeschrieben und nichts neu bewertet.

**Neue** Details gehoeren nicht hierher, sondern nach Inhaltstyp:
`docs/DECISIONS.md` (Entscheidungen), `docs/reports/` (Messungen),
`docs/notes/` (laufende Notizen), git-Commit-Body (geaenderte Dateien).

Die Gliederung spiegelt die Phasen und Abschnitte aus `docs/TODO.md`.

## Ausführungsreihenfolge (Roadmap)

#### Roadmap: Ausfuehrungsreihenfolge (Vorspann)

> Die Phasen unten sind historisch gewachsen und **nicht** mehr strikt von oben nach unten abzuarbeiten. Diese Roadmap gibt die tatsaechliche Ausführungsreihenfolge nach Abhaengigkeit vor. Leitprinzip: erst den Payment-Split (Phase 4.7) fertigstellen, **dann** messen — ein Lasttest davor wuerde das alte, sleep-gebundene System vermessen.

## Phase 4: Interface & Testing

### Lasttests (`load-tests/`)

#### Reaktive Sold-Out-Erkennung im Lasttest

> - [x] Restrukturiere den lokalen Lasttest auf reaktive Sold-Out-Erkennung statt fixer Phasen-Timer: `spike-phase-a.js` (Warm-Up/Ramp-Up/Sustain) + `spike-phase-b.js` (Cool-Down), orchestriert durch `scripts/local/run-spike.mjs` (pollt Availability, stoppt Phase A per SIGINT bei bestaetigtem Sold-Out) (ADR-025) — behebt, dass Baseline A mitten im Peak statt am beabsichtigten Sold-Out-Uebergang endete.

## Phase 4.5: Monitoring & Observability

#### Dashboard-PromQL gegen fehlende Zero-Serien

> - [x] Korrigiere Dashboard-PromQL fuer fehlende Zero-Serien (`or vector(0)`), damit Pending/Queue/Error/Failure/Reliability bei null Fehlern nicht als `No data` verschwinden. — Jeder potenziell fehlende Serien-Operand (failed/5xx/409/rollbacks/compensations/redeliveries/idempotency) in Order-Lifecycle-, Pub/Sub-Queue-, API-Performance-, Worker-Reliability- und Reservation-Consistency-Dashboards mit `or vector(0)` umschlossen; Subtraktions-/Divisions-Ausdruecke operandenweise zero-gefuellt, damit gesundes Null sichtbar bleibt statt zu kollabieren.

#### E2E-Latenz-Buckets und Throughput-Panel

> - [x] Erweitere `order_e2e_latency_seconds` ueber den 30-s-Bucket hinaus und benenne die rollende Completion-Rate als Throughput-Verhaeltnis; entferne die irrefuehrende Legendensumme der kumulativen Counts. — Buckets auf `[…,30,60,120,180,300,450,600]` erweitert (Baseline A ~406 s klippte bei 30 s); Panel „Completion Rate (5m)“ → „Worker/API Throughput Ratio (5m)“ (kein `max:1`-Clip mehr, Schwellen < 1 / ≥ 1); Legenden-`sum` auf den kumulativen Order-Lifecycle-/Worker-Reliability-Panels durch `last` ersetzt (ADR-023-Nachtrag).

#### redis_exporter und DB-/Runtime-Bottleneck-Metriken

> - [x] Fuege `redis_exporter` sowie CPU/Event-Loop-, PostgreSQL-Pool-Wait-, Query-Latency- und Lock-Wait-Metriken fuer belastbare Bottleneck-Zuordnung hinzu. — `redis_exporter`-Container + Prometheus-Job; Worker exponiert `db_pool_connections` (inkl. Pool-Wait via `waiting`), `db_query_duration_seconds` (Timing am DI-Seam, nicht via `pool.query`-Patch) und `db_locks_waiting` (Sampler aus `pg_stat_activity`); CPU/Event-Loop kamen bereits aus `collectDefaultMetrics` und sind jetzt im neuen Dashboard „DB & Runtime“ sichtbar. Ende-zu-Ende gegen die laufende Infra verifiziert (ADR-026).

## Phase 4.6: Standard-Flow-Optimierung (vgl. `docs/reports/ANALYSIS-STANDARD-FLOW.md`)

#### #5 Reservation-Ledger statt Keyspace-SCAN

> - [x] #5 (durch Baseline A praezisiert): Accepted-but-not-finalized Reservations als ZSet/Ledger (`tickets:event:{eventId}:reservations`, Score = Erstellungszeit, kein TTL) statt Keyspace-SCAN; Entfernung nur durch Worker-Finalisierung (`ZREM` im Finalize-Script) / Kompensation. Reconcile zaehlt via `ZCARD` (O(1)) statt SCAN; Ablauf ist nur ein Stale-Kandidat (`ZCOUNT` → `reservation_ledger_stale`-Gauge, Schwellwert `RESERVATION_STALE_SECONDS`) fuer den Reaper (Phase 6), **keine** automatische Rueckbuchung. Behebt das Baseline-A-Oversell-Risiko (temporaer -314k Drift bei 120-s-TTL vs. ~406-s-E2E). Neuer ADR-026, ADR-022/023-Status aktualisiert; Lua gegen `hts-redis` verifiziert. Regressionstest: Reconcile bucht bei alten/stale Reservierungen kein Inventar zurueck.

## Phase 4.7: Checkout & Payment-Simulation (Web + API)

#### Phase 4.7: Ziel und Leitentscheidung

> Ziel: Der Kauf laeuft nicht mehr als ein einziger `POST /buy`-Klick, sondern als realistischer Checkout — Reservierung beim "Kaufen", ein Payment-Modal mit simuliertem 3DS, und danach ein Live-Order-Status auf derselben Seite. Leitentscheidung (siehe neuen ADR-028): **`POST /buy` reserviert nur, die neue synchrone Pay-Route published** — das Ticket ist waehrend der Zahlung gehalten, der Worker sieht die Order erst nach bestaetigter Zahlung.

#### Wo lebt die Payment-Latenz?

> **Wo lebt die Payment-Latenz?** Der 1-s-Payment-Mock verlaesst das Backend vollstaendig: Der Worker-Sleep wird entfernt, und die Pay-Route macht **keinen** Server-Sleep. Die simulierte 3DS-Verzoegerung ist ein reines Frontend-UX-Artefakt (Spinner/OTP im Modal). Damit hat das Backend nirgends kuenstliche Latenz — Worker und `/pay` sind beide ~ms-schnell, und der Lasttest misst echte Infra-Kapazitaet statt eines Mock-Sleeps (genau die Falle von Baseline A). Konsequenz: k6 faehrt `/buy`→`/pay` back-to-back ohne Payment-Delay; eine bewusste "N gehaltene Reservierungen waehrend Checkout"-Simulation waere ein explizites `sleep()` im k6-Skript, kein Backend-Verhalten (ADR-028).

### Backend: Reserve/Pay-Split (`apps/api` + `packages/types`)

#### Buy entkoppeln

> - [x] **Buy entkoppeln:** `POST /api/tickets/:eventId/buy` reserviert nur noch (Lua: `DECR available` + Ledger-`ZADD` + `pending`-Order) und liefert `orderId` + `202`, **ohne** Pub/Sub-Publish. Der bisherige Publish-Rollback-Pfad entfaellt an dieser Stelle (kein Publish mehr im Buy). Der Reservierungs-Record traegt jetzt `firstName`/`lastName`, damit die Pay-Route den `BuyTicketEvent` rekonstruieren kann. Buy-Route-Unit-Tests und die E2E-Flow-Tests auf Reserve-only umgestellt (Response-Message `Ticket reserved`); die publish-/worker-abhaengigen E2E-Flows kehren mit der Pay-Route zurueck.

#### Payment-DTO in packages/types

> - [x] **Payment-DTO in `packages/types`:** Zod-Schema fuer den (simulierten) Payment-Request (`cardHolder`, `cardNumber`, `expiry`, `cvc`) + Response (`confirmed`, `orderId`). Keine echten Kartendaten — reine Simulation; im Schema klar als Fake/Dummy kennzeichnen und keine Persistenz der Zahlungsdaten. Zusaetzlich `pendingOrderReservationSchema` (Pending-Status + `firstName`/`lastName`) ergaenzt, damit die Pay-Route den Kaeufer aus `orders:{orderId}` rekonstruieren kann; der oeffentliche `GET /orders`-Status-Contract bleibt via schmalerem `orderStatusResponseSchema` unveraendert.

#### Worker-Sleep entfernen

> - [x] **Worker-Sleep entfernen:** Den 1-s-Payment-Mock in `apps/worker/src/lib/handle-buy-ticket-message.ts` (`await (deps.sleep ?? setTimeout)(1000)`) samt `sleep`-Dependency und zugehoerigen Tests geloescht. Der Worker ist jetzt reiner Persist-Consumer (`buy_ticket` + `ZREM` + Finalisierung). Stale-Kommentar in `packages/env/src/index.ts` und die Flow-Control-/Durchsatz-Notiz in `ARCHITECTURE.md` korrigiert. (Loest das Phase-3-Todo "Simuliere Payment-Provider Latenz (1s Sleep)" ab.)

#### Synchrone Pay-Route

> - [x] **Synchrone Pay-Route:** `POST /api/orders/:orderId/pay` — validiert das Payment-DTO und **published** `BuyTicketEvent` an Pub/Sub, antwortet synchron (`200`, sobald der Publish bestaetigt ist). **Kein Server-Sleep** — die 3DS-Verzoegerung ist Frontend-UX (siehe Leitentscheidung oben). Async-Writes-Regel bleibt gewahrt: die Route schreibt niemals in PostgreSQL, sie published nur; die Persistenz traegt weiterhin der Worker. `queuedAt` wird beim Publish (Pay-Zeitpunkt) gesetzt, damit die E2E-Latenz nur noch Publish→Persist misst. Kaeuferdaten stammen aus dem Reservierungs-Record; fehlende Reservierung → `404`, bereits finalisierte Order → `409`. Neuer Counter `payments_confirmed_total`.

#### Checkout-Abbruch und Timeout behandeln

> - [x] **Checkout-Abbruch/Timeout behandeln:** Bricht der Nutzer das Modal ab oder scheitert 3DS, bleibt die Ledger-Reservierung sonst als Phantom-Anspruch stehen (ZSet ohne TTL, ADR-027). Explizite Release-Route (`POST /api/orders/:orderId/cancel`, ruft `releaseTicketReservation`) ergaenzt: idempotent (fehlende Reservierung → `cancelled: false`), bereits finalisierte Order → `409`; das Aufraeumen wirklich verwaister Reservierungen bleibt beim Reaper (Phase 6). Neuer Counter `checkouts_cancelled_total` (nur bei tatsaechlicher Freigabe).

#### Metriken und Observability nachziehen

> - [x] **Metriken/Observability nachziehen:** (a) `order_e2e_latency_seconds` misst nach dem Split nur noch Publish→Persist (~ms statt ~406 s) — die auf Baseline A getunten 600-s-Buckets (`apps/worker/src/lib/metrics.ts`) auf eine Millisekunden-Leiter (`[0.001 … 10]`) zurueckgenommen und `queuedAt`-Semantik in ADR-023 (Nachtrag 2026-07-17) angepasst. (b) Checkout-Funnel-Counter ergaenzt: `reservations_created` (Buy), `payments_confirmed` (Pay), `checkouts_cancelled` (Cancel) — Counter landeten mit ihren jeweiligen Routen; Grafana-Order-Lifecycle-Dashboard um Funnel-Panel + Abandon-Rate-Gauge (PromQL: `1 − paid/reserved`) erweitert.

#### Tests zum Reserve/Pay-Split

> - [x] **Tests:** Pay-Route (Happy Path publish + `200`, `404`/`409`, Publish-Fehler → Rollback, Aggregate-Error), Cancel-Route (Release + idempotent + `409` auf finalisiert), Worker ohne Sleep (Persist-Only, keine `deps.sleep`-Dependency mehr), sowie die End-to-End-Flow-Tests (`tests/e2e/`) auf `buy` (reserve) → `pay` (publish) → Worker → `GET /api/orders/:orderId` umgestellt (Happy `completed`, Pay-Publish-Rollback, terminaler P0001-`failed`-Pfad, Sold-Out `409`).

#### ADR-028 und Doku-Lockstep

> - [x] **ADR-028 + Doku-Lockstep:** Neuer ADR-028 (Reserve→Pay→Publish-Split; Payment-Latenz lebt im Frontend, nicht im Backend; Interaktion mit Async-Writes-Regel und Reservation-Ledger ADR-027) angelegt. ADR-013 (Payment Flow Mocking) annotiert: Mock wandert Worker→Frontend. ADR-023 (E2E-Observability) auf neue `queuedAt`-Semantik aktualisiert. `ARCHITECTURE.md` Happy-Path (jetzt 9 Schritte: buy reserviert, pay published, Worker ohne Sleep), Flow-Diagramm (`/buy` ohne Publish; neue `/pay`+`/cancel`) und Redis-Key-Lifecycle (Ledger spannt den Checkout; Pending-TTL deckt das Zahlungsfenster) aktualisiert. `REQUIREMENTS.md` um eine API-Surface-Tabelle inkl. `/pay` + `/cancel` ergaenzt.

### Frontend: Checkout-Flow (`apps/web`)

#### Auto-Fill Namen

> - [x] **Auto-Fill Namen:** Vor-/Nachname-Inputs beim Betreten der `open`-Phase mit zufaelligen Namen vorbefuellen (kleiner clientseitiger Name-Generator, keine externe Dependency); weiterhin editierbar. — `apps/web/lib/names.ts` (Generator ohne Dependency), `ActiveSaleView` befuellt Vor-/Nachname lazy beim Mount und re-randomisiert nach erfolgreichem Kauf.

#### Payment-Modal

> - [x] **Payment-Modal:** Nach "Ticket kaufen" zuerst `POST /buy` (Reservierung), dann Tailwind-Modal oeffnen mit vorbefuellten Fake-Zahlungsdaten (Karteninhaber, Kartennummer, Ablaufdatum, CVC). Kein CSS ausserhalb von Tailwind. — `components/PaymentModal.tsx` (Tailwind-only), `lib/payment.ts` (Fake-Karten-Generator, 4242-Testnummer), `payOrder`/`cancelOrder` in `lib/api.ts`; `ActiveSaleView` oeffnet das Modal mit der `orderId` aus dem Reserve-Response.

#### Fake-3DS-Challenge

> - [x] **Fake-3DS-Challenge:** Nach "Bezahlen" einen simulierten 3DS-Schritt anzeigen (z. B. Spinner/OTP-Prompt), der `POST /api/orders/:orderId/pay` aufruft; Erfolg/Fehler sauber im Modal behandeln. — `PaymentModal`-Statemachine `form → challenge → processing`: "Bezahlen" oeffnet den 3DS-OTP-Prompt (vorbefuellter Sim-Code), erst "Bestätigen" ruft `POST /pay`; Fehler (`404`/`409`/sonstige) landen als Banner zurueck im Kartenformular.

#### Modal-Abbruch

> - [x] **Modal-Abbruch:** Beim Schliessen/Abbrechen des Modals `POST /api/orders/:orderId/cancel` aufrufen, damit die Reservierung freigegeben wird. — `handleCancelCheckout` in `ActiveSaleView` gibt beim Modal-Close (X/Abbrechen/Backdrop/Escape) die Reservierung idempotent frei (fire-and-forget, UI wird sofort zurueckgesetzt); `onPaid` loest **keinen** Cancel aus.

#### Neue tracking-Phase

> - [x] **Neue `tracking`-Phase:** Nach erfolgreicher Zahlung auf eine neue Inline-Phase der Single-Page umschalten (bestehendes `Phase`-Modell `loading|upcoming|open|soldout` um `tracking` erweitern), die den Order-Status anzeigt. — `Phase` um `tracking` erweitert; `trackingOrderId` auf `TicketPage`-Ebene hat Vorrang vor der Verfuegbarkeits-Phase, `ActiveSaleView.onPaid` hebt nach bestaetigter Zahlung dorthin. Neue `TrackingView` (Order-Kurz-ID + „Neues Ticket“-Reset); Live-Polling folgt im naechsten Todo.

#### Live-Order-Status

> - [x] **Live-Order-Status:** In der `tracking`-Phase `GET /api/orders/:orderId` pollen (Backoff/Jitter aus Phase 6 optional beruecksichtigen) und `pending → completed|failed` inkl. Ticket-Referenz live darstellen; Fehl-/Failed-Status verstaendlich anzeigen. — `hooks/useOrderStatus.ts` pollt (2 s + Jitter) und stoppt bei Final-Status; `fetchOrderStatus` in `lib/api.ts`; `TrackingView` rendert `pending` (Spinner), `completed` (Ticket-Referenz) und `failed` (`failureReason`) live.

## Backlog: Near-Term-Arbeit nach Phase 4.7 (Stage 2–4)

### Stage 2 — DB-Hot-Row (naechster echter Limiter nach dem Sleep-Removal)

#### #7 isoliert benchmarken

> - [x] #7 isoliert benchmarken (vor Umsetzung): Flow-Control >1.000 setzen und DB-Pool-Wait/Query-/Lock-Wait messen. **Neu gefasst:** der frueher noetige Schritt "Payment-Mock deaktivieren" entfaellt — mit dem Worker-Sleep-Removal aus Phase 4.7 ist der 1-s-Mock weg, der `sold_count`-Hot-Row-UPDATE ist damit direkt als Limiter isolierbar (Baseline A traf nur den 500/s-Flow-Control-Deckel und bewies den Hot-Row-Limiter nicht separat). — Fokussierter Publish-Micro-Bench `scripts/local/bench-hot-row.mjs` (`pnpm bench:hot-row`, published `BuyTicketEvent`s direkt an Pub/Sub, misst Drain-Durchsatz + `pg_stat_activity`-Lock-Wait-Backends + Worker-`/metrics`). BEFORE mit `FLOW_CONTROL=2000`/`POOL_MAX=50`: **235 tickets/s, 49/50 Backends im Lock-Wait** auf der einen `events`-Row — Hot-Row als Limiter bewiesen (`docs/reports/hot-row-bench/README.md`).

#### #7 buy_ticket ohne sold_count-Hot-Row

> - [x] #7: `buy_ticket` ohne `sold_count`-Hot-Row-UPDATE (Aggregation im Reconcile); Order direkt als `completed` einfuegen (ADR-011-Update, Migration + `db:push`, Guardrail-Script `check-buy-ticket-contract.mjs`). — Migration `0009_buy_ticket_without_sold_count_hot_row.sql` (via `db:apply-sql` angewendet + in Postgres verifiziert; `db:push` zeigt keinen Schema-Drift, Spalte bleibt). `listEventInventorySnapshots` liest den Verkaufsstand jetzt via `COUNT(tickets)`; neuer `persistEventSoldCounts` schreibt ihn im Reconcile-Loop als Snapshot nach `events.sold_count` zurueck (optionaler `persistSoldCounts`-Dep, erst nach der Redis-Korrektur). Guardrail erzwingt den Direkt-`completed`-Insert **und** die Abwesenheit des `sold_count`-Increments. Tests aktualisiert (db-Integration, order-processing inkl. abgeleitetem Snapshot, Reconcile-Write-Back + Fehlerreihenfolge, e2e Happy-Path gruen). AFTER-Bench: **26.385 tickets/s bei 0 Lock-Wait-Backends** (~112× vs. BEFORE), Reconcile materialisierte `sold_count` korrekt (`docs/reports/hot-row-bench/README.md`).

### Stage 3 — Pre-Baseline-Cleanups (guenstig, vor dem Kapazitaetslauf buendeln)

#### #9 Pub/Sub-Provisioning nach scripts/local

> - [x] #9: Topic/Subscription-Provisioning (Emulator-Bootstrapping) nach `scripts/local/` verschieben; `*Like`-Typen und Zweiphasen-Start entfernen. — Provisioning lag bereits in `scripts/local/reset-seed.mjs` (Emulator-REST); die duplizierte In-Plugin-Maschinerie entfernt: API-Publisher (`apps/api/src/plugins/pubsub.ts`) ohne `onReady`-Exists/Create-Hook, Worker-Subscriber (`apps/worker/src/plugins/pubsub.ts`) ohne `ensureSubscription`-Await — beide sind jetzt reine Runtime-Clients, die die Ressourcen als vorhanden voraussetzen (harter Fehler beim ersten Publish/Subscribe statt Auto-Create). `*Like`-Schattentypen (`TopicLike`/`SubscriptionLike`/`SubscriptionOptionsLike`/`PubSubClientLike`) durch die echten `@google-cloud/pubsub`-Typen (`PubSub`/`Topic`/`Subscription`/`Message`) ersetzt; Plugin-Tests injizieren gecastete Fakes. Orphan-Env `PUBSUB_STARTUP_TIMEOUT_MS` samt `.env`/`.env.test`-Eintrag entfernt (`startup-timeout.ts` bleibt — Redis-Plugin nutzt es). Worker-Plugin verliert den nun ungenutzten `topicName`-Parameter (Subscription ist bereits an ihr Topic gebunden). Doku: `ARCHITECTURE.md` um Abschnitt „Pub/Sub-Provisioning" ergaenzt (`pnpm seed` ist lokale Boot-Voraussetzung). Verifiziert: api/worker/e2e-Tests gruen, Type-Check/Lint sauber, realer Publish→Consume-Smoke gegen `hts-pubsub` nach `pnpm seed` erfolgreich.

#### Sale-Unlock-Gate gegen echtes Redis testen

> - [x] Sale-Unlock-Gate: das atomare Reserve-Lua-Script gegen echtes Redis testen (fehlender `opensAt`-Key, `opensAt=0`, `nowMs` vor/nach dem Schwellwert) — der bestehende Unit-Test mockt nur den `-2`-Rueckgabewert (ADR-024-Follow-up). — Integrationstest `apps/api/test/lib/reserve-ticket-script.redis.test.ts` fuehrt das echte `RESERVE_TICKET_SCRIPT` via `registerTicketRedisScripts` gegen `hts-redis` aus: alle vier Gate-Faelle plus Sold-Out (`-1`), inkl. Nachweis, dass die Fehlerpfade (`-2`/`-1`) nichts schreiben und der Erfolgsfall `DECR`/`ZADD`/`SET`+TTL + korrekten Ledger-Score (= `nowMs`) setzt. `ioredis` als API-devDependency ergaenzt; frische UUID-Keys pro Test mit Cleanup (keine Restdaten im Container). ADR-024 um Nachtrag ergaenzt (inkl. Korrektur des `ARGV[5]`→`ARGV[4]`/`KEYS[4]`-Drifts). Verifiziert: 5/5 neue Tests gruen, volle api-Suite 32/32, Type-Check/Lint sauber.

#### Fehler-Response-Schemas fuer Buy, Pay und Cancel

> - [x] Buy-Route: `409` (Sold-Out) und `425` (Too Early) im OpenAPI-Response-Schema deklarieren; **nach dem Buy/Pay-Split** zusammen mit den neuen `/pay`- und `/cancel`-Response-Schemas erledigen, damit die Schemas nur einmal angefasst werden (ADR-024-Follow-up). — Neue wiederverwendbare Fabrik `httpErrorResponseSchema(statusCode, errorName)` in `packages/types/src/tickets.ts` (Form `{ statusCode, error, message, reqId }`, exakt wie der globale Error-Handler sendet) plus benannte Schemas `notFoundErrorResponseSchema`/`conflictErrorResponseSchema`/`tooEarlyErrorResponseSchema`; das bestehende `orderStatusNotFoundResponseSchema` ist jetzt ein Alias darauf (DRY, kein Copy-Paste). `response`-Maps deklariert: Buy `409`+`425`, Pay `404`+`409`, Cancel `409`. Die `REQUIREMENTS.md`-API-Surface-Tabelle dokumentierte diese Codes bereits — der Code holt den Contract jetzt ein (keine neue ADR noetig). Neuer HTTP-Inject-Test `apps/api/test/routes/error-responses.test.ts` beweist ueber die echte `fastify-type-provider-zod`-Serialisierung, dass jeder deklarierte Fehlerstatus schema-konform serialisiert (eine Fehlanpassung waere ein 500). Verifiziert: 5/5 neue Tests gruen, api-Suite 37/37, e2e 4/4, Type-Check/Lint sauber.

#### k6-Checkout-Funnel (Blocker fuer Baseline B)

> - [x] **k6-Checkout-Funnel (Blocker fuer Baseline B):** `load-tests/lib/scenario-helpers.js` von reserve-only (`POST /buy`) auf den vollen Checkout-Flow umstellen — `buy` (reserviert, `202`) → `pay` (`POST /api/orders/:orderId/pay`, published) → Worker persistiert → optional `GET /api/orders/:orderId`-Poll bis `completed|failed`. Grund: seit dem Reserve/Pay/Publish-Split (Phase 4.7, ADR-028) published das alte `/buy`-only-Skript nie, der Worker sieht keine Order, **null bezahlte/abgeschlossene Orders** trotz sinkender `available`. Reserve-Record traegt `firstName`/`lastName`; Pay braucht keine echten Kartendaten (Fake-DTO). — `runCheckout()` fuehrt `buyTicket()` (liefert `orderId` bei `202`, sonst `null` bei `409`/`425`) → `payOrder()` (Fake-`4242…`-DTO, published) → optionalen `pollOrderStatus()` (nur bei `CHECKOUT_POLL=true`, Env `CHECKOUT_POLL_MAX_ATTEMPTS`/`CHECKOUT_POLL_INTERVAL`). Alle Requests mit `endpoint`-Tag. `cancelOrder()`-Helper bereits vorhanden (Verzweigung folgt im Abandonment-Todo). README um Funnel-Beschreibung + neue Env-Vars ergaenzt. Verifiziert: k6-Smoke (2 VUs × 20 Iter, Poll an) → 40/40 Checks gruen, und der Worker persistierte real **20 completed Orders + 20 Tickets** in PostgreSQL (reserve-only haette 0 gezeigt).

#### Abandonment und Think-Time im Funnel

> - [x] **Abandonment + Think-Time im Funnel modellieren:** Nach dem Reserve pro Iteration verzweigen — Mehrheit (~88 %) → `pay`, ein Teil (~8 %) → `cancel` (`POST /api/orders/:orderId/cancel`, gibt Reservierung frei), Rest (~4 %) → abbrechen ohne Cancel (Phantom-Reservierung, Reaper-Kandidat). Da das Backend nach dem Split **keine** kuenstliche Latenz mehr hat (Worker-Sleep raus, `/pay` ohne Server-Sleep), lebt die 3DS-/Karteneingabe-Denkzeit als explizites `sleep()` im k6-Skript (ADR-028). Zwei Profile: _capacity_ (`sleep≈0`, back-to-back → misst rohe Infra-Kapazitaet, Vergleichsgrundlage fuer Baseline B) und _realism_ (randomisierte Denkzeit ~2–8 s → misst gleichzeitig gehaltene Ledger-Reservierungen + Redis-Memory). Denkzeit blaeht die VU-Zahl massiv auf und ist damit der Grund fuer die ~20k-VU-/verteilter-Runner-Anforderung in Stage 4. — `runCheckout()` verzweigt nach dem Reserve per `Math.random()`: `< PAY_RATE` → `pay`, `< PAY_RATE+CANCEL_RATE` → `cancel`, sonst Abbruch ohne Cancel (Env `PAY_RATE=0.88`/`CANCEL_RATE=0.08`). `thinkTime()` ist im `capacity`-Profil (Default) ein No-Op und im `realism`-Profil ein randomisiertes `sleep(THINK_TIME_MIN..THINK_TIME_MAX)`. README um Abandonment-/Profil-Abschnitt + Env-Vars ergaenzt. Verifiziert gegen die Live-Infra (100 Iter, capacity): **87 completed + 6 cancelled (available +6) + 7 Ledger-Phantoms = 100** (≈88/8/4 %); realism-Profil: iteration_duration avg 5,19 s (2,08–7,85 s), capacity: ~15 ms back-to-back.

#### Sold-Out-Erkennung im Orchestrator korrigieren

> - [x] **Sold-Out-Erkennung im Orchestrator korrigieren:** `scripts/local/run-spike.mjs` stoppt Phase A beim ersten `available <= 0`. Mit Cancels/Abandons oszilliert `available` jetzt (Cancel macht `INCR available`), kann also 0 kurz treffen und wieder steigen → Phase A stoppt verfrueht. Stop-Bedingung auf tatsaechlich verkaufte/abgeschlossene Orders umstellen (DB `sold_count` bzw. `orders_completed`-Counter) statt auf reserve-getriebenes `available`. — `pollUntilSoldOutOrExit` pollt jetzt den monotonen Worker-Counter `orders_completed_total` (neuer `fetchCompletedCount()`-Parser, `WORKER_METRICS_URL` Default `:10003/metrics`) und erkennt Sold-Out als **Plateau** (Stagnation ueber `SPIKE_SOLDOUT_CONFIRM_POLLS` Polls) statt am oszillierenden `available`. Guard `completed > 0` blockt Fehlalarm in der Pre-Sale-Phase. `main()` nur noch bei Direktausfuehrung (`import.meta.url`-Guard), damit die Funktionen testbar sind. Doku-Lockstep: ARCHITECTURE + README + ADR-025-Nachtrag. Verifiziert gegen die Live-Infra: `fetchCompletedCount()` = 93, Plateau→Sold-Out nach 3 Stalls (~1,2 s), `completed==0`-Guard verhindert Sold-Out (Stub-Server, timeout statt Stop).

#### k6-Metriken nach Endpoint, Status und Fehlerklasse

> - [x] Ergaenze k6-Metriken nach Endpoint, HTTP-Status und Transportfehlerklasse, damit die 0,28 % Requests ohne App-Response diagnostizierbar sind. **Nach dem Funnel-Umbau:** pro Stufe (`buy`/`pay`/`cancel`/`availability`/`orders`) getrennt taggen, damit die Funnel-Abbruchrate (`1 − paid/reserved`) auch lastseitig sichtbar wird. — Eigene `k6/metrics`-Counter in `scenario-helpers.js`: Funnel (`funnel_reserved`/`funnel_paid`/`funnel_cancelled`/`funnel_sold_out`/`funnel_too_early`/`funnel_abandoned` → Abbruchrate `1 − funnel_paid/funnel_reserved`), `requests_by_status` (getaggt `{endpoint,status}`) und `transport_errors` (getaggt `{endpoint,error_code}` — die Requests ohne App-Response). Neuer `recordResponse(res, endpoint)`-Helper an allen fuenf Endpoints. README um Diagnose-Metrik-Abschnitt ergaenzt. Verifiziert gegen die Live-Infra: 100-Iter-Smoke → `funnel_reserved=100, funnel_paid=90, funnel_cancelled=8, funnel_abandoned=2` (Summe 100 ✓); JSON-Output bestaetigt die Tags `requests_by_status{buy:202,pay:200}` und — gegen einen toten Port — `transport_errors{buy:1212}` (Connection-Refused).

### Stage 4 — Echter Kapazitaetsnachweis (System jetzt sleeplos + Hot-Row-optimiert)

#### Dedizierter LoadTest-Run gegen gebauten Stand

> - [x] **Dedizierter LoadTest-Run gegen gebauten Stand (nicht `pnpm dev`):** Fuer Baseline B API/Worker nicht im Dev-Modus fahren. `apps/api` und `apps/worker` starten `dev` via `tsc-watch --onSuccess "…dev:start"` mit `fastify start **-P** …` — das `-P` schaltet **pino-pretty** (synchroner, den Event-Loop blockierender Log-Transform) ein, und der `tsc-watch`-Compiler/FS-Watcher konkurriert lokal um dieselben Cores wie k6+Postgres+Redis+Prometheus (ein FS-Event mitten im Lauf triggert sogar Rebuild+Restart → Lauf ruiniert). Beide laufen ohnehin schon auf kompiliertem `dist/app.js`, der Unterschied ist also Pretty-Logs + Watcher, nicht der TS-Interpreter. Massnahme: je ein `start:loadtest`-Script (`pnpm run build` → `fastify start` **ohne** `-P`, mit `NODE_ENV=production`, `LOG_LEVEL=warn`, `-l warn`) in `apps/api` und `apps/worker`; Dev-Scripts unveraendert lassen. Optional in `run-spike.mjs`/README als empfohlenen Start dokumentieren. — `start:loadtest` in `apps/api/package.json` und `apps/worker/package.json` ergaenzt: `pnpm run build && NODE_ENV=production LOG_LEVEL=warn DISABLE_REQUEST_LOGGING=true fastify start -l warn -p <port> dist/app.js` (ohne `-P`, ohne `tsc-watch`). Dev-Scripts unveraendert. Empfohlener Start in `load-tests/README.md` dokumentiert (Abschnitt „API/Worker fuer den Lasttest starten (gebauter Stand)“).

#### Request-Logging fuer den Lasttest abschaltbar machen

> - [x] **Request-Logging fuer den Lasttest abschaltbar machen (`disableRequestLogging`):** Fastify loggt per Default pro Request automatisch `incoming request`/`request completed` — bei 10k+ RPS die versteckte Log-Last (nicht die wenigen eigenen `log.info`). Env-Flag `DISABLE_REQUEST_LOGGING` in `packages/env/src/index.ts` ergaenzen (sicheres Boolean-Pattern, **nicht** `z.coerce.boolean()`, weil `"false"` → `true`; stattdessen `z.enum(["true","false"]).default("false").transform(v => v === "true")` o.ae.), in beiden `app.ts` (`apps/api`, `apps/worker`) als `disableRequestLogging: env.DISABLE_REQUEST_LOGGING` in die `options` haengen und im `start:loadtest`-Script auf `true` setzen. Default `false` → Dev/Test-Verhalten unveraendert. Zusammen mit `LOG_LEVEL=warn` faellt das automatische Per-Request-Logging im Kapazitaetslauf weg, eigene Warn/Error-Logs bleiben. — Umgesetzt exakt wie beschrieben: `DISABLE_REQUEST_LOGGING` via `z.enum(["true","false"]).default("false").transform(v => v === "true")` in `@repo/env`, `disableRequestLogging: env.DISABLE_REQUEST_LOGGING` in beide `app.ts`-`options`, `=true` in beiden `start:loadtest`-Scripts, `=false` in `.env.test`. Type-Check/Lint/Prettier gruen.

#### Worker-Resubscribe nach Seed/Reset

> - [x] **Worker-Resubscribe nach Seed/Reset (Baseline-B-Blocker):** `scripts/local/reset-seed.mjs` (und damit `pnpm spike` beim Start) **loescht und recreated** die Pub/Sub-Subscription per Emulator-REST. Laeuft der Worker zu diesem Zeitpunkt bereits, haengt sein Streaming-Pull danach an einer serverseitig geloeschten Subscription — er persistiert nichts mehr (Symptom: sinkende `available`, aber **0 abgeschlossene Orders**; beim Stage-3-Funnel-Test reproduziert, sobald waehrend eines laufenden Workers ein zweites Mal geseedet wurde). Vorbestehend, **nicht** durch den Provisioning-Umbau (#9) verursacht — #9 hat das Reseed-Verhalten nicht veraendert; der neue Runtime-Only-Client macht das Fehlen des Auto-Resubscribe nur sichtbarer. **Rein lokales Harness-Artefakt:** die Subscription existiert beim Worker-Boot (er subscribed sauber) und wird erst _danach_ vom Reseed geloescht; in Produktion provisioniert Terraform die Subscription einmalig, sie verschwindet nie unter dem Worker. Der Fix gehoert daher in **scripts/local**, nicht in den Worker: (a) `reset-seed.mjs` die Subscription **nur anlegen, wenn sie fehlt** statt sie zu loeschen+neu-anzulegen (idempotentes Provisioning, kein Bruch fuer aktive Consumer; Backlog bei Bedarf via `subscriptions.seek` auf `now` purgen statt Delete); (b) alternativ `run-spike.mjs` den Worker nach dem Seed neu starten. **Bewusst NICHT** gewaehlt: eine worker-seitige Reconnect-/Recreate-Logik bei `NOT_FOUND` — das wuerde exakt die mit #9/ADR-028 entfernte Subscription-Lifecycle-Maschinerie wieder einfuehren und in Produktion ein echtes Fehlersignal (Subscription weg) verschleiern; der Runtime-Client soll dort hart scheitern. Vor Baseline B loesen, sonst misst der Lauf 0 Persistenz. Danach die Sold-Out-Erkennung (Completion-Counter, Stage 3) end-to-end via `pnpm spike` gegenpruefen. — Umgesetzt via Option (a): `resetPubSub()` in `scripts/local/reset-seed.mjs` loescht Topic+Subscription nicht mehr, sondern legt sie idempotent an (`PUT` mit akzeptiertem `409 ALREADY_EXISTS`). Kein Bruch fuer aktive Consumer, keine Worker-Aenderung (haelt #9/ADR-028: App = reiner Runtime-Client). Verifiziert: `reset-seed` zweimal hintereinander idempotent; und im zuvor kaputten Szenario (Worker laeuft → 2× reseed → 1 Event direkt publiziert) persistiert der Worker das Event (`tickets = 1`) — die Subscription ueberlebt den Reseed. Der volle `pnpm spike`-End-to-End-Cross-Check der Sold-Out-Erkennung faellt mit dem Baseline-B-Lauf unten zusammen.

#### MVP der Report-Automation

> - [x] Implementiere das MVP aus `docs/suggested/LOAD-TEST-REPORT-AUTOMATION.md`: Run-Manifest, k6-JSON-Summaries, Before/After-Counter, Drain-Monitor, Histogram-Saturation, DB-/Redis-Snapshots, Invarianten und deterministischer Markdown-Report. — Umgesetzt unter `scripts/load-test/` mit klarer Trennung pur/side-effecting (`scripts/load-test/README.md`): pure Kernmodule (`openmetrics`, `derive`, `validate`, `analyze`, `render-markdown`, `compare`, `manifest`) + IO-Collectors (`snapshots` via Container-CLI, `prometheus`, `drain`, `processes`, `config`) + Orchestrator `run-and-report.mjs`. Versionierte Regeln in `load-tests/report-policy.json` + `load-tests/report-queries.json`. Drei Kommandos verdrahtet: `pnpm spike:report` (voller Lauf, braucht Live-Stack), `pnpm spike:analyze -- <run-dir>` (rein, kein Netz/DB), `pnpm spike:compare -- <a> <b>` (verweigert inkompatible Kapazitaets-Claims). Deterministisches Markdown (keine Wall-Clock-Timestamps → idempotent). MVP-Scope: Run-ID/Git/Config/Timestamps, k6-Summaries + Dropped-Rate-Validity, Before/After-Counter-Deltas mit Reset-Detection, Drain-Pending-Monitor, E2E-Histogram count/sum/buckets + Saturation/censored-Quantile, PostgreSQL-/Redis-Snapshots, Drift, Invarianten-Verdicts, regelbasierte Recommendations. Tests: 47 `node:test`-Faelle inkl. anonymisierter Baseline-A-Fixture + approved Golden `derived.json`/`report.md` (reproduziert die Baseline-A-Story: benchmark `invalid` wegen 61,82 % dropped, system `pass` weil alle Quellen konvergieren, E2E p95/p99 `> 30 s` zensiert) + Idempotenz- + Drain-Logik-Tests. In CI verdrahtet (`pnpm spike:report:test` im `quality`-Job, Node 22 + 24). Rohartefakte unter `artifacts/load-tests/` (gitignored). **Hinweis:** `run-and-report.mjs` (side-effecting) braucht einen laufenden Stack (Docker + gebaute API/Worker + k6 + Prometheus) und wird beim Baseline-B-Lauf (Todo unten) erstmals end-to-end ausgefuehrt; die reine Analyse ist ohne Stack via Golden-Tests abgedeckt.

#### Baseline-B-Lauf

> - [x] Fuehre den restrukturierten Lasttest (`pnpm spike`) als neue **Baseline B** aus und vergleiche gegen Baseline A (`docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md`). **Neu gefasst:** die ~481/s-Worker-Drain-Framing aus Baseline A ist hinfaellig (der 1-s-Sleep ist weg); erwarteter Engpass ist jetzt Flow-Control bzw. der DB-Hot-Row (Stage 2). Vorbedingungen #5 (Ledger) und die P1-Dashboard-Fixes sind bereits erledigt. **Zusaetzliche Vorbedingung:** der k6-Checkout-Funnel-Umbau aus Stage 3 muss vorher stehen — ohne `/pay` misst der Lauf keine Persistenz (0 abgeschlossene Orders). — Ausgefuehrt am 2026-07-26 via `pnpm spike:report` (erster End-to-End-Lauf der Report-Automation), Report: `docs/reports/baseline-b-2026-07-26/LOAD-TEST-REPORT-2026-07-26.md`, Run-ID `2026-07-26T13-13-41-929Z-eb62aca`. **Ergebnis:** `benchmark=invalid` (67,66 % dropped iterations — Generator-Saturation bei `maxVUs=10000`, Generator co-lokalisiert mit dem SUT; #244 bleibt damit der Blocker fuer jede Kapazitaetsaussage) und `system=fail`. Fachlich lief das System jedoch **korrekt**: 867.575 Orders persistiert, **0 Nachrichtenverlust** (publiziert == persistiert), Inventar-Erhaltung exakt (`available 89.359 + verkauft 867.575 + Ledger 43.066 = 1.000.000`), Reservierungs-Buchhaltung exakt (`reserved 989.545 == publiziert + cancelled + gehalten`), `pending_orders = 0`, Drift 0, 0 terminale Fehler. Der `fail`-Verdict und der Drain-Timeout stammen aus **zwei Defekten der Messkette** (falsche Drain-Formel auf `orders_accepted_total` statt `payments_confirmed_total`; `orders_completed_total` zaehlt idempotent absorbierte Redeliveries als Completion) — erfasst als Folge-Todos im Abschnitt "Backlog: Baseline-B-Nachlauf (entdeckt 2026-07-26)" am Dateiende. Bestaetigter Fortschritt gegenueber Baseline A: E2E-Mittel **406 s → 7,52 s (−98,1 %)**; `spike:compare` verweigert den Kapazitaetsvergleich korrekt (Exit 3).

#### Sold-Out-Fehlalarm durch stale Completion-Counter

> - [x] **Sold-Out-Fehlalarm in der Pre-Sale-Phase durch stale Completion-Counter (Korrektur zu #235):** `orders_completed_total` ist ein **prozess-lebensdauer**-Counter des Workers und ueberlebt `reset-seed`/`pnpm spike` (der Worker wird nicht neugestartet). `pollUntilSoldOutOrExit` startete daher mit einem **Carryover > 0** aus dem vorigen Lauf; der in #235 eingefuehrte Guard `completed > 0` griff nicht, weil er 0 als Pre-Sale-Marker annimmt. Symptom: `pnpm spike` stoppte Phase A nach ~12 s ("plateaued at 2"), obwohl der Verkauf erst in 60 s oeffnet. Fix: `pollUntilSoldOutOrExit` haelt den ersten Poll-Wert als `baseline` fest und erkennt ein Plateau erst als Sold-Out, wenn **relativ zur baseline** neue Orders abgeschlossen wurden (`completed > baseline`) und dann stagnieren — self-healing gegenueber Staleness, ohne Worker-Neustart/Counter-Reset (haelt App = reiner Runtime-Client). Verifiziert mit einem `fetch`-stubbenden Harness ueber die echte Funktion: stale Carryover 2 im Pre-Sale → kein Stop; Carryover 2 → Verkauf → Plateau 500 → Sold-Out (baseline 2); frischer Worker 0 ohne Verkauf → kein Stop. Doku-Lockstep: ADR-025-Nachtrag (2026-07-20).

## Phase 4.8: API-Performance-Dashboard — fehlende Order-Routen

#### Phase 4.8: Nachtrag zum API-Performance-Dashboard

> > Nachtrag zum abgeschlossenen Phase-4.5-Todo „Grafana-Dashboard: API Performance" (`monitoring/grafana/provisioning/dashboards/api-performance.json`). Das Dashboard bricht bisher nur `/api/tickets/:eventId/buy` und `/api/tickets/:eventId/availability` einzeln auf; die Order-Routen `POST /api/orders/:orderId/pay` und `POST /api/orders/:orderId/cancel` fehlen als eigene Graphen, obwohl `http_request_duration_seconds` sie bereits per `route`-Label exponiert.

## Phase 5: Cloud Deployment (GCP)

#### Sale-Unlock-Zeitquelle bei mehreren API-Replicas

> - [ ] **Sale-Unlock-Zeitquelle bei `API replicas > 1` (ADR-024):** Der `opensAt`-Gate-Check vergleicht aktuell gegen `nowMs`, das die API aus `Date.now()` uebergibt — nicht gegen `redis.call("TIME")` im Lua-Script. Das haelt das Script unabhaengig von Redis' Lua-Replikationsverhalten und erlaubt, denselben Zeitstempel als `queuedAt` im Pub/Sub-Payload wiederzuverwenden (ein `Date.now()` pro Request statt zwei). Trade-off: Der Verkaufsstart oeffnet nur so praezise, wie die Uhren der API-Pods synchron sind; bei Uhr-Drift faellt der Unlock pro Pod um die Drift-Spanne unterschiedlich. Lokal (ein Prozess) irrelevant, in GKE deckt NTP-Sync die geforderte Sekunden-Genauigkeit. **Extension:** Falls sub-sekunden-exakter, prozessuebergreifend identischer Unlock gefordert wird, auf `redis.call("TIME")` (eine autoritative Uhr) umstellen — dann entfaellt die `queuedAt`-Wiederverwendung und es faellt ein zweiter Zeitstempel-Roundtrip an; ADR-024 entsprechend aktualisieren.

## Phase 6: Optional & Resilience (Maximum Learning)

#### Reaper-Job fuer stale pending Orders und Ledger-Reservationen

> - [ ] Ergänze Reaper-Job fuer stale `pending` Orders und stale Ledger-Reservationen inkl. sicherer Kompensation. Datenbasis liegt seit ADR-026 vor: `ZRANGEBYSCORE tickets:event:{eventId}:reservations 0 (now − RESERVATION_STALE_SECONDS·1000)` liefert die Kandidaten deterministisch, die `reservation_ledger_stale`-Gauge macht den Bestand sichtbar. Rueckgewinnung nur nach Order-/Queue-Recovery (DLQ), nicht allein wegen Alter.

## Backlog: Baseline-B-Nachlauf (entdeckt 2026-07-26)

#### Backlog Baseline-B-Nachlauf: Vorspann

> Aus dem Baseline-B-Lauf (`docs/reports/baseline-b-2026-07-26/LOAD-TEST-REPORT-2026-07-26.md`, Run-ID `2026-07-26T13-13-41-929Z-eb62aca`) neu entdeckte Arbeit. Nach der append-forward-Regel bewusst hier statt rueckwirkend in Stage 3/4. **Reihenfolge = Prioritaet:** P0 blockiert die Auswertbarkeit jedes weiteren Laufs, P2 blockiert die Kapazitaetsaussage.

### P0 — Messkette reparieren (sonst ist auch Baseline C nicht auswertbar)

#### Drain-Formel auf den Publish-Zeitpunkt umstellen

> - [x] **Drain-Formel auf den Publish-Zeitpunkt umstellen (garantierter Timeout, Report §4.4):** `waitForDrain` in `scripts/load-test/lib/drain.mjs` (und `fetchCounters` in `scripts/load-test/run-and-report.mjs`) berechnen `pending = orders_accepted_total − completed − failed`. `orders_accepted_total` wird aber beim **Reserve** (`/buy`) inkrementiert, publiziert wird erst bei **`/pay`**. Seit der Abandonment-Modellierung (Stage 3: 8 % Cancel, 4 % Abbruch) werden ~12 % der Reservierungen nie publiziert — die Differenz kann **nie** 0 erreichen und laeuft zwangsweise in den 900-s-Timeout. In Baseline B: `accepted 989.545 − completed 897.006 = 92.539` gemeldeter "Backlog", tatsaechlich `publiziert 867.575 − persistiert 867.575 = 0`. Fix: Numerator auf `payments_confirmed_total` umstellen. Weil `report-policy.json` `requireDrainForCorrectnessVerdict: true` setzt, kostet der Defekt zusaetzlich das Korrektheits-Verdict. Golden-Fixtures mitziehen. — Umgesetzt: `fetchCounters` liefert `published` aus `payments_confirmed_total`, `waitForDrain` rechnet `pending = Δpublished − Δcompleted − Δfailed` (Feld `accepted` → `published` umbenannt, damit die falsche Quelle nicht versehentlich wieder eingesetzt wird). Dieselbe Verwechslung steckte in der Invariante `accepted == completed + failed` — jetzt `published == completed + failed`; `paymentsConfirmed` als Counter in `COUNTER_QUERIES` + `report-queries.json` ergaenzt. **Rueckwaertskompatibel:** Laeufe vor ADR-028 (Baseline A) publizierten im `/buy` und kennen `payments_confirmed_total` nicht — `deriveReport` erkennt das an der Abwesenheit der Serie und faellt auf `orders_accepted_total` zurueck, damit die historische Auswertung gueltig bleibt. Neuer Regressionstest (100 reserviert / 88 publiziert / 88 persistiert = korrekt) + Pre-Split-Fallback-Test; Goldens neu genehmigt (nur `paymentsConfirmed`-Zeile + Invarianten-ID, Baseline A bleibt `system=pass`).

#### Invariante dbTickets gleich completed

> - [x] **Invariante `dbTickets == completed` redelivery-tolerant fassen (Report §4.3):** `orders_completed_total` zaehlt idempotent absorbierte Duplikate als Completion. Mechanik: der Emulator lieferte unter Ueberlast ~3,4 % der Nachrichten erneut aus; `buy_ticket` absorbiert sie via `INSERT INTO orders … ON CONFLICT (id) DO NOTHING` und liefert die **bestehende** `ticket_id` zurueck, der Handler sieht Erfolg und `buyTicketOutcomePolicy.completed` (`apps/worker/src/routes/pubsub-listener.ts:83`) inkrementiert den Counter. In Baseline B: `completed 897.006` vs `tickets 867.575` → 29.431 Differenz, **ohne** Doppel-Ticket oder Oversell. Vorschlag: `executeBuyTicket` unterscheidet Insert von Konflikt (z. B. `buy_ticket` liefert zusaetzlich ein `inserted`-Flag), der Handler liefert ein eigenes Outcome `duplicate-absorbed` → neuer Counter `worker_duplicate_deliveries_total` statt `orders_completed_total`. Danach ist die Invariante wieder scharf. Alternativ (schwaecher) die Invariante gegen `payments_confirmed_total` pruefen. — **Umgesetzt, aber anders als hier vorgeschlagen** (Variante nach Rueckfrage gewaehlt): nicht die Invariante aufgeweicht und nicht `buy_ticket` migriert, sondern die **Ursache** behoben. Das Finalize-Lua-Script berechnete das Erst-Finalisierung-Signal ohnehin schon und verwarf es (`redis.call("ZREM", ...)` gefolgt von `return 1`); es gibt jetzt den `ZREM`-Wert zurueck: `1` = Ledger-Anspruch war noch da (Erst-Finalisierung), `0` = absorbierte Redelivery. Neues Outcome `duplicate-absorbed` (ACK) + Counter `worker_duplicate_deliveries_total`; `orders_completed_total` zaehlt damit wieder genau ein Ticket pro Verkauf, und das Duplikat wird bewusst auch nicht in `order_e2e_latency_seconds` beobachtet. Dieselbe Mechanik nutzt `COMPENSATE_RESERVATION_SCRIPT` bereits. **Keine DB-Migration** — die Alternative (`buy_ticket` liefert `inserted`) haette `DROP`+`CREATE FUNCTION` und damit eine Deploy-Reihenfolge-Abhaengigkeit bei kuenftigen GKE-Rolling-Updates erzwungen (ADR-023-Nachtrag 2026-07-26 dokumentiert die Abwaegung). Wirkung ueber den Report hinaus: beide Grafana-Durchsatz-Panels und die Sold-Out-Erkennung rechnen nicht mehr mit 3,39 % Luft. Tests: Integrationstest gegen `hts-redis` (`1` dann `0`, Recovery-Seiteneffekte laufen auch beim Duplikat, TTLs gesetzt) + Handler-Unit-Test; ACK/NACK-Guardrail-Tabelle und `ARCHITECTURE.md` um die neue Zeile ergaenzt.

#### Labeled Counter ohne Baseline im Snapshot

> - [x] **Labeled Counter beim Boot auf 0 initialisieren (Report §4.2):** `prom-client` emittiert einen Labeled Counter erst nach dem ersten Increment. Vor dem Lauf fehlten daher `orders_failed_total`, `publish_rollbacks_total`, `worker_redeliveries_total`, `worker_compensations_total`, `worker_idempotency_hits_total` und `checkouts_cancelled_total` komplett in `/metrics` → `hasBaseline: false` → `benchmark=invalid` **unabhaengig** von der Generator-Frage (`requireCounterBaselines: true` in `report-policy.json`). Fix: alle bekannten Label-Kombinationen (Event-IDs aus dem Seed) beim Boot mit `.inc(0)` vorinitialisieren, in `apps/api/src/lib/metrics.ts` und `apps/worker/src/lib/metrics.ts`. — **Bewusst anders geloest als hier vorgeschlagen:** nicht durch Vorinitialisieren in den Services, sondern im Analyzer (`resolveCounter` in `scripts/load-test/lib/analyze.mjs`). Gruende: (a) die Policy war ohnehin schon so **dokumentiert** — jeder Counter in `report-queries.json` traegt `"absence": "zero-if-target-up"`, nur der OpenMetrics-Text-Pfad implementierte sie nicht; (b) Vorinitialisieren braeuchte die Label-Werte (Event-IDs) zur Boot-Zeit, was der API einen PostgreSQL-Read aufzwingen wuerde — verboten durch die "Redis fuer Reads"-Regel; (c) der Analyzer-Fix wirkt unabhaengig von Label-Kardinalitaet und damit auch fuer kuenftige Events. Sicherheitsnetz gegen die naheliegende Fehlinterpretation: Abwesenheit gilt nur dann als 0, wenn der Snapshot **ueberhaupt** Samples enthaelt (der Orchestrator wirft bei fehlgeschlagenem Scrape) — ein leerer Snapshot bleibt `null`, damit ein nicht erreichbarer Service nie als "null Aktivitaet" durchgeht. Zwei Regressionstests decken beide Richtungen ab. Nachweis am echten Baseline-B-Artefakt: `benchmark=invalid` nennt jetzt nur noch die Generator-Saturation, die Counter-Baseline-Beschwerde ist weg.

### P1 — Messumgebung

#### Prometheus stirbt am k6-Remote-Write

> - [x] **Prometheus stirbt am k6-Remote-Write (Report §4.1):** die `{endpoint,status}`-Tags pro Iteration erzeugen genug Kardinalitaet, um `hts-prometheus` auf **5,5 GiB** zu treiben; am Ende des Laufs antwortete es mit **503 Service Unavailable**. Folge: `health.json.apiUp`/`workerUp` = `null` und die `apiRpsPeak`/`workerCompletionRatePeak`-Range-Queries aus `report-queries.json` sind nicht auswertbar — Baseline B hat **keine Peak-Werte**. Optionen: Remote-Write-Tags reduzieren, `--out` fuer den Kapazitaetslauf abschalten und nur die JSON-Summary nutzen, oder Prometheus Memory/Retention dimensionieren. — Umgesetzt: k6s Prometheus-Remote-Write ist jetzt **opt-in** (`K6_PROMETHEUS_RW=true`) und im Default **aus**, in `scripts/load-test/lib/processes.mjs` und `scripts/local/run-spike.mjs`. Entscheidende Erkenntnis beim Nachpruefen: der Report liest **gar keine** k6-Serien aus Prometheus — alle Queries in `report-queries.json` gehen gegen `job="api"`/`job="worker"`. Das Remote-Write diente nur dem Live-Blick in Grafana und kostete den Lauf dafuer genau die Daten, die der Report braucht (`apiUp`/`workerUp` = `null`, beide Peak-Range-Queries unauswertbar). Abschalten verbessert die Auswertbarkeit also strikt. Argument-Bau nach `buildK6Args` extrahiert, damit der Default ohne k6-Prozess testbar ist (2 Tests).

#### Config-Snapshot aus den Services ziehen

> - [x] **Config-Snapshot aus den Services statt aus dem Orchestrator ziehen (Report §2):** `redactConfig(process.env)` in `run-and-report.mjs` snapshottet die Umgebung des **Orchestrator**-Prozesses. Der Report weist deshalb `NODE_ENV=test` aus, obwohl API und Worker via `start:loadtest` mit `NODE_ENV=production` liefen — die dokumentierte Messkonfiguration ist damit irrefuehrend. Fix: die effektive Config von den Services selbst beziehen (z. B. `/metrics`-Build-Info-Gauge oder ein `GET /debug/config`). — Umgesetzt via Prometheus-Info-Metrik: neuer Gauge `service_config_info` (Wert immer 1, Konfiguration in den Labels) in `apps/api/src/lib/metrics.ts` und `apps/worker/src/lib/metrics.ts`. Der Collector zieht `/metrics` ohnehin vor und nach dem Lauf ab, also ist der Service selbst die verlaessliche Quelle — kein neuer Debug-Endpunkt noetig. `deriveReport` liest die Labels nach `derived.serviceConfig.{api,worker}` (`readServiceConfig`), der Renderer weist beide Quellen jetzt **getrennt und beschriftet** aus: „Configuration (load harness / orchestrator env)" fuer die Last-Knobs (`LOAD_PROFILE`, `PAY_RATE`, …) und „Effective <service> configuration (reported by the service)" fuer `NODE_ENV`/`LOG_LEVEL`/`DISABLE_REQUEST_LOGGING` (Worker zusaetzlich `PUBSUB_FLOW_CONTROL_MAX_MESSAGES`, `DATABASE_POOL_MAX`, `WORKER_RECONCILE_MODE`). Beide Quellen beschreiben verschiedene Dinge, deshalb bleibt die Orchestrator-Config erhalten statt ersetzt zu werden. Services ohne den Gauge erscheinen als `null`, damit Baseline A ehrlich bleibt statt falsch beschriftet. Live verifiziert: beide Services melden `node_env="production"` unter `start:loadtest` — genau der Wert, den Baseline B als `test` auswies. 2 neue Tests (Quelle korrekt + Absenz-Fall).

#### Plateau-Detektor gegen Host-Contention haerten

> - [x] **Plateau-Detektor gegen Host-Contention haerten (Report §4.5):** der Detektor aus ADR-025 beendete Phase A per SIGINT nach 888 s von 990 s, obwohl noch **89.359 Tickets verfuegbar** waren. Unter Generator-Saturation (Load Average 21,95 bei 11 Cores) genuegen 3 Polls (~9 s) ohne neue Completion, und so ein Stall ist kein Sold-Out. Folge: Baseline B beantwortet **nicht**, wie lange ein 1M-Ticket-Ausverkauf dauert. Vorschlag: Sold-Out nur akzeptieren, wenn das Completion-Plateau **und** ein niedriger `available`-Stand zusammenfallen (bzw. `ZCARD`-Ledger die Restmenge erklaert); ADR-025 entsprechend als Nachtrag aktualisieren. — Umgesetzt: das Plateau wird jetzt gegen den Rest-Bestand klassifiziert. `available == 0` → `sold-out`, sonst → `stalled`; ist der Bestand nicht lesbar, bleibt es bewusst `stalled` (nie ein behaupteter Ausverkauf ohne Beleg). Beide Faelle stoppen die Phase weiterhin — die restlichen 15 min Sicherheitsnetz messen nichts —, aber der Grund wird berichtet: `runPhaseAReactive` liefert `{ exitCode, stopReason, availableAtStop }`, der Orchestrator schreibt das nach `k6/phase-a-meta.json` und warnt sichtbar, `run-spike.mjs` loggt `STALL (not a sell-out)`. Bestand kommt im Orchestrator aus `readAvailableTickets` (Redis) und in `run-spike.mjs` aus der Availability-Route. Neue Testdatei `scripts/load-test/test/processes.test.mjs` deckt alle drei Klassifikationen ab (inkl. des Baseline-B-Falls: Plateau mit 89.359 verfuegbaren Tickets → `stalled`); `pollUntilSoldOut` nimmt dafuer ein injizierbares `fetchImpl`.

### P2 — Kapazitaet

#### Baseline C nach P0 und P1

> - [ ] **Erst nach P0/P1 einen erneuten Kapazitaetslauf (Baseline C) fahren.** Voraussetzung bleibt das offene Stage-4-Todo #244 (Generator vom SUT trennen / verteilter Runner): Baseline B verwarf **67,66 %** der geplanten Iterationen bei erreichtem `maxVUs: 10000`-Deckel und ~3.954 ausgelieferten req/s — auf derselben Maschine ist das nicht heilbar. Ohne #244 bleibt jede RPS-Zahl unbelegt.

### Beobachtung fuer das Storage-Review (Phase 6)

#### Datenbasis aus Baseline B fuer das Storage-Review

> - [ ] **Datenbasis aus Baseline B in das Storage-Review einspeisen:** Redis hielt nach dem Lauf **1.777.916 Keys / 505 MB** fuer 867.575 Orders (~582 Byte/Order), PostgreSQL 246 MB; zusaetzlich standen **43.066** Ledger-Reservierungen als Phantom-Ansprueche offen (die modellierten ~4 % Abbrecher ohne Cancel — erwartetes ADR-027-Verhalten und genau die Zielmenge des Reaper-Todos).

## Backlog: Report-Automation cloud-faehig machen (Vorbedingung fuer den GCP-Lasttest)

#### Backlog Report-Automation cloud-faehig: Vorspann

> Beim Abarbeiten des Baseline-B-Nachlaufs (2026-07-26) entdeckt: die Report-Automation ist derzeit **lokal-only** und kann gegen GCP nichts erheben. Das ist der eigentliche Grund, warum `pnpm spike:report` nach dem Deployment nicht einfach gegen GKE laeuft. Bewusst als eigener Abschnitt, weil diese Punkte **Terraform/GKE-Kontext** brauchen und laut Absprache erst nach einer gemeinsamen Einarbeitung in GCP angefasst werden.

#### State-Snapshots gegen Cloud SQL und Memorystore

> - [ ] **State-Snapshots gegen Cloud SQL / Memorystore:** `scripts/load-test/lib/snapshots.mjs` ist auf `docker exec hts-postgres psql` bzw. `docker exec hts-redis redis-cli` **hart verdrahtet** (Konstanten `POSTGRES_CONTAINER`/`REDIS_CONTAINER`). Gegen Cloud SQL und Memorystore gibt es diese Container nicht — `snapshotPostgres`/`snapshotRedis`/`readAvailableTickets` liefern dort gar nichts. Braucht einen austauschbaren Zugriffspfad (echte Verbindung via `@repo/db`-Pool bzw. Redis-Client statt Container-CLI), damit derselbe pure Analyzer beide Umgebungen bedienen kann.

#### Preflight umgebungsabhaengig machen

> - [ ] **Preflight umgebungsabhaengig machen:** `preflight()` in `scripts/load-test/lib/config.mjs` verlangt per Default die laufenden Container `hts-postgres`/`hts-redis`/`hts-pubsub` und bricht in einem Cloud-Lauf sofort ab. Die Signatur nimmt `requiredContainers` bereits als Option — es fehlt ein Cloud-Profil, das stattdessen Erreichbarkeit/Health der echten Endpunkte prueft.

#### Seed-Pfad fuer die Cloud

> - [ ] **Seed-Pfad fuer die Cloud:** `scripts/local/reset-seed.mjs` provisioniert Topic/Subscription ueber die **Emulator**-REST-API und truncated per Container-CLI. In GCP provisioniert Terraform (ADR-010), und das Zuruecksetzen des Test-Events braucht einen anderen Weg. Klaeren, ob ein Cloud-Lauf ueberhaupt seeden darf oder gegen einen vorbereiteten Datenstand faehrt.

#### Verteilten k6-Runner orchestrieren

> - [ ] **Verteilter k6-Runner orchestrieren:** `spawnK6` startet genau **einen lokalen** k6-Prozess und wertet dessen Exit-Code plus eine `--summary-export`-Datei aus. Fuer das 50k-RPS-Ziel (Stage-4-Todo #244) braucht es mehrere Generator-Knoten und ein Zusammenfuehren der Teil-Summaries, bevor `summarisePhase` sie auswerten kann. Haengt direkt an #244.

#### Monitoring-Quelle fuer den Cloud-Lauf

> - [ ] **Monitoring-Quelle fuer den Cloud-Lauf entscheiden:** `report-queries.json` fragt `job="api"`/`job="worker"` gegen einen lokalen Prometheus. In GCP ist zu entscheiden, ob Managed Service for Prometheus, ein selbst betriebener Prometheus im Cluster oder Cloud Monitoring die Quelle ist — und wie `targetUp`/die Range-Queries darauf abbilden. (Der lokale Prometheus ist beim Baseline-B-Lauf am k6-Remote-Write gestorben; das Remote-Write ist inzwischen standardmaessig aus, die Dimensionierungsfrage bleibt fuer die Cloud offen.)
