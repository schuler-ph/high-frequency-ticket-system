# Baseline C — Lokaler Spike-Lasttest 2026-07-26 (Abend)

Run-ID: `2026-07-26T18-23-27-719Z-cddc364`
Commit: `cddc364` (`main`)
Kommando: `pnpm spike:report`
Rohartefakte: [`artifacts/`](./artifacts/) · Dashboards: [`images/`](./images/) · deterministischer Report: [`artifacts/generated-report.md`](./artifacts/generated-report.md)

---

## 1. Kurzfassung

Baseline C ist der erste Lauf **nach** den Messketten-Fixes aus dem Baseline-B-Nachlauf — und der erste, der **tatsaechlich ausverkauft** ist.

| Frage                                      | Antwort                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Sind 50k RPS nachgewiesen?                 | **Nein.** 21,85 % verworfene Iterationen (Policy-Grenze 5 %).                      |
| Ist die Messkette jetzt vertrauenswuerdig? | **Ja.** Nur noch **ein** Invaliditaetsgrund, alle Invarianten gruen, Drain sauber. |
| Ist das System korrekt?                    | **Ja, mit einer Einschraenkung** — 389 Ansprueche mehr als Kapazitaet (§5).        |
| Was ist jetzt der Engpass?                 | **Der DB-Connection-Pool** (`DATABASE_POOL_MAX=20`), nicht mehr der Hot-Row.       |
| Ausverkauf erreicht?                       | **Ja** — `available = 0`, `stopReason: "sold-out"`.                                |

**Kernbefund:** Das System hat 957.053 Tickets in ~6,4 Minuten korrekt persistiert, mit 0 Fehlern, 0 Redeliveries und einer E2E-Latenz von 0,24 s im Mittel. Die Kapazitaetsfrage bleibt offen, aber der naechste Engpass ist jetzt **praezise lokalisiert und billig zu testen**.

---

## 2. Messkonfiguration

| Parameter                          | Wert                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Host                               | darwin/arm64, **11 CPUs** — Generator **und** SUT                                                                            |
| Seeded Capacity                    | 1.000.000 Tickets                                                                                                            |
| Lastprofil                         | `capacity` (keine Denkzeit)                                                                                                  |
| Abandonment                        | `PAY_RATE=0.88`, `CANCEL_RATE=0.08`                                                                                          |
| API/Worker                         | `start:loadtest` — von den Services selbst gemeldet: `node_env=production`, `log_level=warn`, `disable_request_logging=true` |
| `PUBSUB_FLOW_CONTROL_MAX_MESSAGES` | 500                                                                                                                          |
| `DATABASE_POOL_MAX`                | **20**                                                                                                                       |
| k6 `maxVUs`                        | **5.000** (Phase A), Ziel 10.000 Iterationen/s                                                                               |
| k6-Remote-Write                    | aus (Default seit dem Nachlauf)                                                                                              |

Zeitachse: Seed 18:23:29 · Sale-Unlock ~18:24:29 · Phase A Ende 18:30:51 (SIGINT bei Sold-Out) · Phase B Ende 18:31:51 · Drain-Ende 18:32:06.
**Offener Verkauf: ~382 s.**

> Die Service-Konfiguration wird jetzt von den Services selbst gemeldet (`service_config_info`), nicht mehr aus der Orchestrator-Umgebung geraten — der Report weist beide getrennt aus.

---

## 3. Was gegenueber Baseline B repariert ist

Alle Fixes lassen sich am Artefakt nachweisen:

| Signal                   | Baseline B                        | Baseline C                                         |
| ------------------------ | --------------------------------- | -------------------------------------------------- |
| Drain                    | `timeout` nach 1.060,8 s          | **`complete` nach 15,0 s**, `pending: 0` ab Poll 1 |
| System-Verdict           | `fail` (3 Invarianten)            | **`pass`** (4/4)                                   |
| Invaliditaetsgruende     | 2 (Counter-Baselines + Generator) | **1** (nur Generator)                              |
| `apiUp` / `workerUp`     | `null` (Prometheus tot)           | **`true`**                                         |
| Gemeldete Service-Config | `NODE_ENV=test` (falsch)          | **`node_env=production`**                          |
| Duplikate                | 29.431 als Verkauf gezaehlt       | **0** (`worker_duplicate_deliveries_total`)        |
| Sold-Out-Erkennung       | Stall als Ausverkauf gewertet     | **`sold-out`**, `availableAtStop = 0`              |
| E2E-Mittel               | 7,52 s                            | **0,2365 s**                                       |
| E2E p95 / p99            | `> 10 s` (zensiert)               | **1,0 s / 2,5 s**, 0 % ueber dem groessten Bucket  |

---

## 4. Ergebnis des Laufs

### Durchsatz

| Metrik                       | Wert                                                 |
| ---------------------------- | ---------------------------------------------------- |
| API-Requests (Spitze)        | **13,0 K req/s** (Mittel 5,58 K)                     |
| Reservierungen (Spitze)      | 3,74 K/s                                             |
| Persistierte Orders (Spitze) | 3,30 K/s                                             |
| Ausgelieferte HTTP-Requests  | 3.989.286 (Phase A)                                  |
| 5xx-Fehlerrate               | **0 %**                                              |
| `POST /buy` Latenz           | p50 42,8 ms · p95 184 ms (Mittel), Spitze p95 874 ms |

### Checkout-Funnel (k6, geht exakt auf)

```
reserved 1.087.012 = paid 957.053 + cancelled 86.623 + abandoned 43.336   ✅
Abbruchrate = 1 − 957.053/1.087.012 = 11,95 %   (modelliert: 12 %)
```

Dazu 48.323 × `409` (ausverkauft) und 29.965 × `425` (zu frueh) — beides erwartete Antworten.

### Korrektheit

| Invariante                        | Erwartet | Tatsaechlich |     |
| --------------------------------- | -------- | ------------ | --- |
| `published == completed + failed` | 957.053  | 957.053      | ✅  |
| `dbOrders == completed + failed`  | 957.053  | 957.053      | ✅  |
| `dbTickets == completed`          | 957.053  | 957.053      | ✅  |
| `pendingOrders == 0`              | 0        | 0            | ✅  |

0 terminale Fehler, 0 Publish-Rollbacks, 0 Kompensationen, 0 Redeliveries, 0 absorbierte Duplikate.

---

## 5. Der eine Korrektheits-Befund: 389 Ansprueche zu viel

```
reserved 1.087.012 − cancelled 86.623      = 1.000.389  Netto-Ansprueche
available 0 + verkauft 957.053 + gehalten 43.336 = 1.000.389
                                   Kapazitaet    = 1.000.000   →  +389
```

**Real ueberverkauft wurde nichts** (957.053 < 1.000.000). Haetten aber alle 43.336 Halter bezahlt, waeren es 389 Tickets zu viel gewesen.

**Ursache — der Reconcile-Loop ist nicht atomar.** `reconcileTicketAvailability` liest erst die DB (`getEventInventorySnapshots`, Zeile 78), dann den Ledger (`countActiveReservations`, Zeile 82). Eine Order, die _zwischen_ den beiden Reads finalisiert, ist in der DB noch nicht gezaehlt und aus dem Ledger schon entfernt — sie zaehlt in **keinem** von beiden. Dadurch faellt `computed` zu hoch aus, und die Delta-Korrektur `incrby(available, -drift)` schiebt Phantom-Inventar nach.

Groessenordnung passt: ~6 Reconcile-Laeufe waehrend des Verkaufs, 389/6 ≈ **65 pro Lauf** ≈ **26 ms Lueckenbreite** bei 2.507 Orders/s.

**Es heilt sich nicht selbst:** `calculateAvailableTickets` klemmt mit `Math.max(…, 0)`. Nach dem Ausverkauf ist der wahre Erwartungswert −389, geklammert 0, die Differenz damit 0 — es wird nie zurueckkorrigiert. In Baseline B war die Drift nur deshalb 0, weil der 17-minuetige Drain-Timeout dem Reconcile ruhige Runden verschafft hatte.

**Und die Ueberwachung ist dafuer blind.** Dashboard und Report widersprechen sich scheinbar (0 vs. 389) — beide rechnen korrekt, aber verschieden:

```
Gauge  (worker):  redisAvailable − max(cap − sold − active, 0)  = 0 − 0      = 0
Report (derive):  redisAvailable − (cap − sold − active)        = 0 − (−389) = 389
```

Die Klammerung macht Ueberzeichnung fuer `redis_db_drift_tickets` unsichtbar — also exakt den Zustand, fuer dessen Erkennung der Gauge existiert.

---

## 6. Warum der Lauf `invalid` ist — und was das diesmal heisst

Genau **ein** Grund: **21,85 % dropped iterations** (840.099 von 3.785.709 geplanten).

| Phase   | Iterationen | Dropped | Geplant   | Ausgefuehrt | VUs max   |
| ------- | ----------- | ------- | --------- | ----------- | --------- |
| phase-a | 2.945.610   | 840.099 | 3.785.709 | 77,81 %     | **5.000** |
| phase-b | 60.000      | 0       | 60.000    | 100,00 %    | 200       |

Der Mechanismus ist ein **anderer** als in Baseline B. Dort lief der Host voll; hier reichte das **VU-Budget** nicht:

> `benoetigte VUs = Rate × Iterationsdauer`. Bei ~0,5 s Iterationsdauer decken 5.000 VUs genau 10.000 Iterationen/s. Als die Latenz im Ausverkaufs-Crunch auf p95 874 ms stieg, waeren ~8.700 VUs noetig gewesen — der Deckel liegt bei 5.000.

Die Verwerfungen sind also **Folge der steigenden Backend-Latenz**, nicht Ursache. Ergaenzend: **109.386 Transportfehler** (2,7 % der Requests ohne App-Antwort) zeigen, dass auch das Netzwerk-Setup des Hosts bei 13 K req/s an Grenzen kam.

Beides bestaetigt erneut das offene Stage-4-Todo #244: Generator und System-under-Test gehoeren getrennt.

---

## 7. Der neue Engpass: der DB-Connection-Pool

Das ist der wertvollste Befund des Laufs.

| Signal                                 | Wert                               |
| -------------------------------------- | ---------------------------------- |
| `db_pool_connections{state="total"}`   | **20** (= `DATABASE_POOL_MAX`)     |
| `db_pool_connections{state="waiting"}` | Mittel **115**, Spitze **1.070**   |
| `db_locks_waiting`                     | **0**                              |
| DB-Query-Latenz                        | p95 460 ms (Mittel), Spitze 1,94 s |
| `buy_ticket` p95                       | 597 ms (Mittel), Spitze 1,94 s     |

**Lock-Waits sind 0** — der Hot-Row aus Backlog #7 ist wirklich weg, PostgreSQL selbst ist nicht umkaempft. Die gemessene Query-Latenz ist deshalb ganz ueberwiegend **Wartezeit auf eine Connection**, nicht Arbeit in der Datenbank (`timeDbQuery` umschliesst das Pool-Acquire).

Gegenprobe ueber Little's Law:

```
20 Connections / 3.300 Completions pro Sekunde  ->  ~6,1 ms mittlere Servicezeit
Theoretische Decke = 20 / 6,1 ms = 3.300/s      ->  exakt der beobachtete Peak
```

Die beobachtete Worker-Decke ist also **rechnerisch identisch** mit der Pool-Groesse geteilt durch die Servicezeit. Damit ist der Pool als bindende Restriktion belegt, nicht nur plausibel.

> **Nachtrag 2026-07-27:** Der wahre Pool-Wait-Peak lag noch hoeher. `max_over_time(db_pool_connections{state="waiting"}[20m])` ueber die Rohdaten liefert **3.578** wartende Acquirer — die im Dashboard ablesbaren 1.070 waren durch das Downsampling der Panel-Aufloesung untertrieben (genau der Grund, warum die Gauges im Dashboard-Audit auf `max_over_time` umgestellt wurden). Der Befund wird dadurch staerker, nicht schwaecher.

Hochrechnung bei gleicher Servicezeit: `POOL_MAX=50` → ~8.250/s, `=100` → ~16.500/s. Der naechste Lauf sollte diesen Knopf drehen, **bevor** ueber Architekturaenderungen (Batching) nachgedacht wird — solange Postgres 6 ms braucht und 0 Lock-Waits meldet, ist nicht die Datenbank das Problem, sondern der Zugang zu ihr.

---

## 8. Speicher-Fussabdruck (Datenbasis fuer das Storage-Review)

| Speicher    | Wert                                                               |
| ----------- | ------------------------------------------------------------------ |
| Redis       | **1.957.446 Keys / 526 MiB** fuer 957.053 Orders (~576 Byte/Order) |
| PostgreSQL  | 270 MB                                                             |
| Redis-Ops   | Spitze 27,9 K ops/s, Hit-Ratio 89,7 %                              |
| `maxmemory` | **nicht gesetzt** (0) — kein Schutz gegen OOM                      |

**42.947 Tickets blieben unverkauft, aber blockiert** (Kapazitaet − verkauft), gehalten von den 43.336 Phantom-Reservierungen. Das ist die Zielmenge des Reaper-Todos (Phase 6) — jetzt mit Zahl.

---

## 9. Grenzen der Aussagekraft

- **Keine Kapazitaetsaussage.** 21,85 % dropped, Generator co-lokalisiert, `maxVUs`-Deckel erreicht.
- **Der gemessene Peak (13 K req/s) ist eine Untergrenze**, kein Maximum: der Backend-Engpass (Pool) war zuerst erschoepft.
- **2,7 % Transportfehler** deuten auf Host-Netzwerkgrenzen, nicht auf Applikationsfehler (5xx = 0 %).
- **`available` erreichte 0, aber 4,3 % des Inventars sind in Phantom-Reservierungen gebunden** — „ausverkauft" heisst hier nicht „alles verkauft".

Was der Lauf **belegt**: fachliche Korrektheit unter 6,4 Minuten echter Dauerlast mit 957.053 persistierten Orders bei 0 Fehlern, eine jetzt vertrauenswuerdige Messkette — und eine praezise, quantifizierte Lokalisierung des naechsten Engpasses.

---

## 10. Abgeleitete Massnahmen

**P0 — vor Baseline D**

1. **Reconcile-Leseordnung umdrehen** (Ledger vor DB), damit der Fehler konservativ wird: eine dazwischen finalisierte Order zaehlt dann doppelt statt gar nicht, die Korrektur **entfernt** Inventar statt welches zu erfinden. Echte Atomaritaet ueber Redis + PostgreSQL ist nicht erreichbar; erreichbar ist die richtige Fehlerrichtung.
2. **Drift-Gauge entklammern** — `Math.max(…, 0)` nur noch fuer den Redis-_Write_, nicht fuer die Metrik.
3. **`DATABASE_POOL_MAX` erhoehen** (50 → 100) und neu messen. Billigster, reversibelster Hebel.

**P1 — Messumgebung**

4. `maxVUs` an das Ziel anpassen oder das Ziel senken; solange `maxVUs × 1/Iterationsdauer < Zielrate` gilt, sind Drops garantiert.
5. Stage-4 #244 (Generator vom SUT trennen) bleibt die Vorbedingung fuer jede echte Kapazitaetsaussage.

**P2 — Dashboards** (Details im Audit, siehe `docs/TODO.md`)

6. Panels, die `orders_accepted_total` als Publish-Groesse verwenden, auf `payments_confirmed_total` umstellen — dieselbe Verwechslung, die in der Drain-Formel bereits behoben wurde.
7. Fehlende Abdeckung ergaenzen: `/pay`- und `/cancel`-Routen, Status `425`, `worker_duplicate_deliveries_total`, `reservation_ledger_active` / `reservation_ledger_stale`.
