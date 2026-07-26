# Baseline B — Lokaler Spike-Lasttest 2026-07-26

Run-ID: `2026-07-26T13-13-41-929Z-eb62aca`
Commit: `eb62aca` (`claude/todos-before-stage-5-aqv1s3`), Working Tree clean
Kommando: `pnpm spike:report` (erster End-to-End-Lauf der Report-Automation aus Stage 4)
Rohartefakte: [`artifacts/`](./artifacts/), deterministischer Report: [`artifacts/generated-report.md`](./artifacts/generated-report.md)

---

## 1. Kurzfassung

Baseline B ist der erste Lauf **nach** dem Reserve/Pay-Split (ADR-028) und der Hot-Row-Entfernung (Backlog #7) — also der erste Lauf ohne kuenstliche Backend-Latenz.

| Frage                                       | Antwort                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Sind 50k RPS nachgewiesen?                  | **Nein.** Der Lastgenerator saturierte bei 67,66 % verworfenen Iterationen.                  |
| Ist das System korrekt unter Dauerlast?     | **Ja.** Alle Inventar-Identitaeten gehen exakt auf (§3), 0 Oversell.                         |
| Sind Nachrichten verloren gegangen?         | **Nein.** 867.575 publiziert, 867.575 persistiert — Verlust 0.                               |
| Warum sagt der Report `system=fail`?        | **Messfehler, nicht Systemfehler** — zwei Harness-Defekte (§4).                              |
| Ist Baseline B mit Baseline A vergleichbar? | **Nein**, `spike:compare` verweigert korrekt (Exit 3): andere Kapazitaet, Candidate invalid. |

**Kernbefund:** Das System hat sich unter ~14 Minuten Dauerlast fachlich einwandfrei verhalten und 867.575 Tickets korrekt persistiert. Der Lauf beweist aber **keine Kapazitaet**, und die zwei `fail`-Signale des Reports sind auf Defekte in der Messkette zurueckzufuehren, nicht auf das System. Beide sind in §6 als Folge-Todos erfasst.

---

## 2. Messkonfiguration

| Parameter                          | Wert                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Host                               | darwin/arm64, **11 CPUs**, 36 GiB RAM — Generator **und** SUT                                                                   |
| Seeded Capacity                    | 1.000.000 Tickets                                                                                                               |
| Lastprofil                         | `capacity` (keine Denkzeit, `buy`→`pay` back-to-back)                                                                           |
| Abandonment                        | `PAY_RATE=0.88`, `CANCEL_RATE=0.08`, Rest Abbruch ohne Cancel                                                                   |
| API/Worker                         | gebauter Stand via `start:loadtest` (kein `-P`/pino-pretty, kein `tsc-watch`, `DISABLE_REQUEST_LOGGING=true`, `LOG_LEVEL=warn`) |
| `PUBSUB_FLOW_CONTROL_MAX_MESSAGES` | 500 (Default)                                                                                                                   |
| `DATABASE_POOL_MAX`                | 20 (Default)                                                                                                                    |
| Phase A                            | 1.000 RPS/45s → Ramp auf 10.000 RPS/45s → Sustain (Netz 15 min)                                                                 |
| Phase B                            | 1.000 RPS flat/1 min (Cool-Down)                                                                                                |

Zeitachse (aus `artifacts/manifest.json`):

| Marke                 | Zeit (UTC)   | Dauer     |
| --------------------- | ------------ | --------- |
| Seed                  | 13:13:42.957 | —         |
| Workload-Start        | 13:13:43.627 | —         |
| Sale-Unlock (`+60s`)  | ~13:14:43    | —         |
| Phase A Ende (SIGINT) | 13:28:47.189 | 903,6 s   |
| Phase B Ende          | 13:29:50.514 | 63,3 s    |
| Drain-Ende (Timeout)  | 13:47:31.338 | 1.060,8 s |

> **Hinweis zur `Configuration`-Sektion des generierten Reports:** dort steht `NODE_ENV=test`. Der Collector snapshottet `process.env` des **Orchestrators**, nicht der Services — API und Worker liefen via `start:loadtest` mit `NODE_ENV=production`. Siehe Folge-Todo in §6.

---

## 3. Was das System nachweislich richtig gemacht hat

Alle vier Identitaeten gehen **exakt** auf (nachgerechnet aus `artifacts/state/after.json` und den `/metrics`-Snapshots):

**(a) Kein Nachrichtenverlust**

```
payments_confirmed_total (publiziert) = 867.575
tickets in PostgreSQL                 = 867.575
                              Verlust =       0
```

**(b) Reservierungs-Buchhaltung geht exakt auf**

```
reserved (989.545) == publiziert (867.575) + cancelled (78.904) + im Ledger gehalten (43.066)
                   == 989.545   ✅ exakt
```

**(c) Inventar-Erhaltung — kein Oversell, kein verlorenes Inventar**

```
available (89.359) + verkauft (867.575) + gehalten (43.066) = 1.000.000
                                              = Capacity      1.000.000   ✅ exakt
```

**(d) Datenbank in sich konsistent**

```
orders = tickets = sold_count = 867.575 ;  pending_orders = 0 ;  redis_db_drift_tickets = 0
```

Dazu: **0 terminale Fehler** (`orders_failed_total` nie inkrementiert), **0 Publish-Rollbacks**, **0 NACK-getriebene Redeliveries** (`worker_redeliveries_total` nie inkrementiert).

Die 43.066 im Ledger gehaltenen Reservierungen sind die modellierten ~4 % Abbrecher ohne Cancel — genau die Phantom-Ansprueche, fuer die der Reaper (Phase 6) zustaendig ist. Sie sind **kein** Defekt, sondern das erwartete Verhalten aus ADR-027.

---

## 4. Warum der Report trotzdem `benchmark=invalid` / `system=fail` sagt

### 4.1 `benchmark=invalid` — Grund 1: Generator-Saturation (echt, erwartet)

| Phase      | Iterationen | Dropped       | Geplant   | Ausgefuehrt | VUs max    |
| ---------- | ----------- | ------------- | --------- | ----------- | ---------- |
| phase-a    | 2.631.805   | **5.627.549** | 8.259.354 | 31,86 %     | **10.000** |
| phase-b    | 58.616      | 1.384         | 60.000    | 97,69 %     | 3.310      |
| **Gesamt** | 2.690.421   | 5.628.933     | 8.319.354 | **32,34 %** |            |

k6 lief in seinen eigenen `maxVUs: 10000`-Deckel und verwarf **67,66 %** der geplanten Iterationen (Policy-Grenze: 5 %). Ausgeliefert wurden ~3.954 req/s bei `http_req_duration` p95 4,67 s / max 52,5 s, 4,18 % Fehlerrate und 179.410 Transportfehlern (Requests ohne App-Response).

**Das ist exakt der Befund von Baseline A (61,82 %) und exakt das, was das offene Todo Stage 4 #244 vorhersagt:** Generator und System-under-Test teilen 11 Cores. Ein Rerun auf derselben Maschine kann das nicht heilen.

Zusaetzlicher Contaminant: **Prometheus** wurde durch k6s Remote-Write-Kardinalitaet (`{endpoint,status}`-Tags pro Iteration) auf **5,5 GiB** getrieben und antwortete am Ende mit **503 Service Unavailable**. Deshalb sind `health.json.apiUp`/`workerUp` = `null` und die Peak-RPS-Range-Queries nicht auswertbar. Host Load Average erreichte 21,95 bei 11 Cores; fremde Container (`envoy`, `mysql`, `redis`, `static-server`) liefen mit.

### 4.2 `benchmark=invalid` — Grund 2: fehlende Counter-Baselines (Harness-Defekt)

Der Report meldet _"Counter baselines were not captured before the run."_ Ursache: `prom-client` emittiert einen Labeled Counter erst **nach dem ersten Increment**. Vor dem Lauf existierten daher `orders_failed_total`, `publish_rollbacks_total`, `worker_redeliveries_total`, `worker_compensations_total`, `worker_idempotency_hits_total` und `checkouts_cancelled_total` gar nicht in `/metrics` → `hasBaseline: false` → Benchmark automatisch invalid, **unabhaengig** von der Generator-Frage.

### 4.3 `system=fail` — `dbTickets == completed` (Metrik-Semantik, kein Datenfehler)

```
orders_completed_total = 897.006
tickets in PostgreSQL  = 867.575
              Differenz =  29.431   (3,39 % der publizierten Nachrichten)
```

Ursache: Der Emulator hat unter Ueberlast ~3,4 % der Nachrichten erneut ausgeliefert (ACK-Timeouts). Diese Duplikate werden **fachlich korrekt** idempotent absorbiert — `buy_ticket` macht `INSERT INTO orders … ON CONFLICT (id) DO NOTHING` und liefert bei Konflikt die **bestehende** `ticket_id` zurueck. Der Handler sieht damit eine erfolgreiche Verarbeitung und liefert `{ kind: "completed" }`; die Policy-Tabelle (`buyTicketOutcomePolicy` in `apps/worker/src/routes/pubsub-listener.ts:83`) inkrementiert `orders_completed_total`.

Ergebnis: **kein Doppel-Ticket, kein Oversell** (siehe §3c) — aber der Counter zaehlt idempotente No-Ops als Completions. Die Invariante `dbTickets == completed` ist damit unter Redelivery grundsaetzlich verletzbar, obwohl das System korrekt ist. Nur 5.297 Duplikate wurden vorher vom Redis-`processed`-Marker abgefangen (`worker_idempotency_hits_total`); die restlichen ~29.431 liefen in den DB-ON-CONFLICT-Pfad.

### 4.4 `drain=timeout` mit "92.539 pending" — falsche Formel (Harness-Defekt)

Der Drain-Monitor berechnet `pending = orders_accepted_total − completed − failed`. `orders_accepted_total` wird aber beim **Reserve** (`/buy`) inkrementiert, publiziert wird erst bei **`/pay`**. Seit der Abandonment-Modellierung (Stage 3) werden ~12 % der Reservierungen nie publiziert (8 % Cancel, 4 % Abbruch) — die Differenz kann daher **nie** 0 erreichen:

```
verwendet:  accepted (989.545) − completed (897.006) = 92.539   → "Backlog", laeuft in den 900s-Timeout
korrekt:    publiziert (867.575) − persistiert (867.575) =    0   → Drain war tatsaechlich vollstaendig
```

Gegenprobe: die Drain-Polls stagnierten ab dem dritten Poll dauerhaft bei 92.539 (`artifacts/drain.json`) — nicht weil der Worker haengt, sondern weil nichts mehr zu tun war. Ein nach dem Lauf publizierter Test-Checkout wurde **sofort** konsumiert und persistiert (`orders_completed_total` 897.007 → 897.008, Order `completed` mit Ticket-Referenz). Der Worker war die ganze Zeit gesund; die Queue war leer.

Weil die Policy `requireDrainForCorrectnessVerdict: true` setzt, kostet dieser Defekt zusaetzlich das Korrektheits-Verdict.

### 4.5 Phase A stoppte 89.359 Tickets vor dem Sold-Out

Der Plateau-Detektor (ADR-025) beendete Phase A per SIGINT nach 888 s von 990 s — zu diesem Zeitpunkt waren aber noch 89.359 Tickets verfuegbar. Unter Generator-Saturation genuegen 3 aufeinanderfolgende Polls (~9 s) ohne neue Completion, und ein solcher Stall ist bei Load Average 21,95 kein Sold-Out-Signal, sondern Host-Contention. **Baseline B beantwortet daher auch nicht, wie lange ein 1M-Ticket-Ausverkauf dauert.**

---

## 5. Vergleich mit Baseline A

`pnpm spike:compare -- scripts/load-test/test/golden/baseline-a.derived.json artifacts/load-tests/2026-07-26T13-13-41-929Z-eb62aca` → **Exit 3, `Compatible for a capacity claim: no`**. Die Automation verweigert den Vergleich korrekt aus drei Gruenden: unterschiedliche Kapazitaet (1.000 vs 1.000.000), unterschiedliches Lastprofil-Feld, und Candidate-Benchmark invalid.

| Metrik            | Baseline A | Baseline B | Δ       |
| ----------------- | ---------- | ---------- | ------- |
| `droppedShare`    | 0,6182     | 0,6766     | +9,5 %  |
| `e2eMean`         | 406,0 s    | **7,52 s** | −98,1 % |
| `ordersCompleted` | 1.000      | 897.006    | ×897    |
| `driftFinal`      | 0          | 0          | 0       |

Der belastbare qualitative Fortschritt: **die E2E-Latenz fiel von 406 s auf 7,5 s (−98,1 %)**. Baseline A war vollstaendig vom 1-s-Worker-Sleep dominiert (ADR-013/028); dieser Anteil ist weg. Die ~481/s-Worker-Drain-Framing aus Baseline A ist damit — wie im Todo vermutet — hinfaellig.

**Aber:** die 7,52 s sind selbst kein Systemwert, sondern zu einem grossen Teil Queue-Wartezeit unter einem ueberlasteten Host (14,09 % der Beobachtungen liegen oberhalb des groessten Buckets von 10 s, p95/p99 sind zensiert). Auch dieser Vergleich taugt nicht als Kapazitaetsaussage.

---

## 6. Abgeleitete Folge-Massnahmen

Erfasst als neue Todos in `docs/TODO.md` (Abschnitt "Backlog: Baseline-B-Nachlauf (entdeckt 2026-07-26)"), nach der append-forward-Regel:

**P0 — Messkette reparieren (sonst ist auch Baseline C nicht auswertbar)**

1. Drain-Formel auf `payments_confirmed_total` umstellen (§4.4) — der aktuelle Timeout ist garantiert, solange Abandonment modelliert wird.
2. Invariante `dbTickets == completed` redelivery-tolerant fassen (§4.3), z. B. gegen `payments_confirmed_total` pruefen und Duplikate separat als `worker_duplicate_deliveries_total` zaehlen statt als Completion.
3. Alle Labeled Counter beim Boot auf 0 initialisieren (§4.2), damit Baselines existieren.

**P1 — Messumgebung**

4. k6-Remote-Write drosseln oder Prometheus dimensionieren (§4.1) — aktuell stirbt Prometheus und nimmt die Peak-Auswertung mit.
5. Config-Snapshot aus den Services statt aus dem Orchestrator ziehen (§2).
6. Plateau-Detektor gegen Host-Contention haerten (§4.5), z. B. Sold-Out zusaetzlich gegen `available == 0` **und** Completion-Plateau.

**P2 — Kapazitaet (unveraendert offen: Stage 4 #244)**

7. Generator vom SUT trennen / verteilter Runner. Ohne das bleibt jede Kapazitaetsaussage unbelegt.

**Beobachtung fuer das Storage-Review (Phase 6)**

Redis hielt nach dem Lauf **1.777.916 Keys / 505 MB** fuer 867.575 Orders (~582 Byte/Order); PostgreSQL 246 MB. Das ist Datenbasis fuer das offene Storage-Review-Todo.

---

## 7. Grenzen der Aussagekraft

- **Keine Kapazitaetsaussage.** 67,66 % Dropped, Generator co-lokalisiert, `maxVUs`-Deckel erreicht.
- **Keine Peak-Werte.** Prometheus antwortete am Ende mit 503; `apiUp`/`workerUp` sind `null`.
- **Kein Sold-Out.** Phase A endete 89.359 Tickets zu frueh (§4.5).
- **p95/p99 der E2E-Latenz sind zensiert** (14,09 % oberhalb 10 s).
- **Fremdlast auf dem Host** (`envoy`, `mysql`, `redis`, `static-server`), Load Average 21,95 bei 11 Cores.

Was der Lauf **belegt**: fachliche Korrektheit unter ~14 Minuten echter Dauerlast mit 867.575 persistierten Orders, exakter Inventar-Erhaltung, 0 Oversell, 0 Nachrichtenverlust und 0 Drift — sowie die Funktionsfaehigkeit der Report-Automation aus Stage 4, die genau die Defekte sichtbar gemacht hat, die sie sichtbar machen soll.
