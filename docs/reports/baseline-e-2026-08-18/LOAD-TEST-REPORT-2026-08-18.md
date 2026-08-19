# Baseline E — Profil-Sweep ueber drei Lastprofile 2026-08-18

Commit: `a05409f` (`main`), alle drei Laeufe
Host: darwin/arm64, 11 CPUs; k6 auf dem Generator-PC via ssh (`BASE_URL=http://10.0.0.1:10002`)
Ausfuehrlicher Report: [`Spike-Sweep-a05409f.pdf`](./Spike-Sweep-a05409f.pdf)
Rohartefakte: [`artifacts/`](./artifacts/) (lokal, gitignoriert), ein Verzeichnis je Run-ID

| Run-ID                             | Profil                      | Kapazitaet | Phase A |
| ---------------------------------- | --------------------------- | ---------- | ------- |
| `2026-08-18T19-09-19-323Z-a05409f` | `browse-and-buy-full-speed` | 1 000 000  | 748 s   |
| `2026-08-18T19-25-51-179Z-a05409f` | `browse-and-buy-human-pace` | 100 000    | 1 024 s |
| `2026-08-18T19-46-56-827Z-a05409f` | `buy-only-full-speed`       | 1 000 000  | 260 s   |

Drei Profile, ein Commit — **keine Wiederholungen desselben Tests**. Die
Durchsatzzahlen der drei Laeufe sind nicht untereinander vergleichbar.

---

## 1. Kurzfassung

| Frage                      | Antwort                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| System-Korrektheit         | ✅ alle drei Laeufe: 0 5xx, 0 `ordersFailed`, 0 Rollbacks, 0 Kompensationen, Drift 0, Drain 15 s |
| Berichtete Verdicts        | ❌ alle drei falsch — ein `fail` zu viel, zwei gerissene Thresholds unsichtbar                   |
| Spitzendurchsatz           | `buy-only`: 1 000 000 Tickets, Plateau ~5 300 Orders/s ueber ~2 min                              |
| REQ-P01 (5k RPS sustained) | erreicht, aber in keinem Lauf zitierbar — alle drei sind `benchmark: invalid`                    |
| Offener Befund Baseline D  | ✅ geklaert, siehe §3                                                                            |

## 2. Messwerte je Lauf (Phase A)

| Messgroesse                                | browse-and-buy-full-speed | browse-and-buy-human-pace | buy-only-full-speed  |
| ------------------------------------------ | ------------------------- | ------------------------- | -------------------- |
| Iterationen angeboten / ausgefuehrt / s    | 9 133 / 8 657             | 9 076 / 4 305             | 7 583 / 4 682        |
| Dropped Iterations                         | 5,2 %                     | 52,6 %                    | 38,3 %               |
| Benoetigte VUs (Deckel 10 000)             | 3 896                     | **15 691**                | **9 904**            |
| HTTP-Requests/s                            | 10 115                    | 4 413                     | 8 529                |
| Order-Plateau (completed/s)                | 3 050                     | ~90                       | **5 300**            |
| `http_req_duration` p95 (Threshold 500 ms) | **876 ms** ❌             | 13,9 ms ✅                | **809 ms** ❌        |
| `POST /pay` p50 / p95 / p99                | 670 / 2 173 / 2 451 ms    | 13 / 24 / 46 ms           | 398 / 936 / 1 548 ms |
| E2E mean (publish → persistiert)           | 218 ms                    | 24 ms                     | 595 ms               |
| `buy_ticket` mean (inkl. Pool-Wait)        | 32,6 ms                   | 1,5 ms                    | **172,9 ms**         |
| DB-Pool wartende Acquirer, mean / max      | 18 / 276                  | 0 / 0                     | **518 / 3 760**      |
| Stop-Grund                                 | `sold-out`                | `k6-exited`               | `sold-out`           |

Buchfuehrung `browse-and-buy-full-speed`: 1 136 706 Reservierungen = 1 000 000
bezahlt + 91 055 storniert + 45 651 abgelaufen (vom Reaper eingesammelt),
Capacity-Delta 0. Alle Abbruchpfade gleichzeitig ausgeuebt.

## 3. Befund: Transportfehler auf dem Buy-Bein sind keine Fehler

Der offene Befund aus [Baseline D §4](../baseline-d-2026-08-17/LOAD-TEST-REPORT-2026-08-17.md)
ist geklaert. `transport_errors` zaehlt an einer einzigen Stelle
(`load-tests/lib/scenario-helpers.js:200-205`) jede Response mit gesetztem
`res.error_code` — und k6 setzt den fuer **jeden** Nicht-2xx-Status, also auch
fuer die erwarteten 409 (ausverkauft) und 425 (Sale noch zu).

Arithmetisch exakt in allen drei Laeufen:
`transport_errors{buy}` = `funnel_sold_out` + `funnel_too_early` + echte Fehler.

| Lauf                      | gemeldet  | 409 sold-out | 425 too-early | echte Fehler |
| ------------------------- | --------- | ------------ | ------------- | ------------ |
| browse-and-buy-full-speed | 1 455 860 | 1 401 433    | 29 775        | 24 652       |
| browse-and-buy-human-pace | 104 715   | 101 113      | 3 602         | 0            |
| buy-only-full-speed       | 217 169   | 104 974      | 76 714        | 35 481       |

Phase B des `buy-only`-Laufs meldet 60 000 Transportfehler bei 60 000 gruenen
Checks und `http_req_failed` = 0 — eine Falsch-Positiv-Rate von 100 %.
`load-tests/README.md:124-126` beschreibt das Gegenteil des tatsaechlichen
Verhaltens.

**Die API hat in keinem der drei Laeufe einen 5xx geliefert.** Jeder Nicht-2xx
war ein bewusster Fachstatus (409, 425, 410).

Die verbleibenden echten Fehler sitzen auf der Verbindungsebene: Abgleich der
k6-Requestzahlen gegen die API-eigenen Zaehler ergibt ~60 800 (0,80 %) bzw.
~34 300 (1,56 %) Requests, die den Dienst nie erreicht haben — passend zu
`http_req_connecting` mit Spitzen um 15 s in beiden Full-Speed-Laeufen gegen
3,0 s im unbelasteten `human-pace`-Lauf.

## 4. Befund: Der `fail`-Verdict im `human-pace`-Lauf ist ein Harness-Defekt

`sellout: sold == totalCapacity` wird allein ueber
`CHECKOUT_PENDING_TIMEOUT_SECONDS <= 600` zugeschaltet
(`scripts/load-test/lib/derive.mjs:301-325`); ob der Lauf ueberhaupt per
Ausverkauf endete, prueft niemand. Der Lauf lief stattdessen in den
15-Minuten-Deckel von k6 (`stopReason: "k6-exited"`) und blieb bei 99 788 von
100 000 stehen.

Die Differenz ist exakt belegt: 100 verfuegbar + 99 788 Tickets + 112 offene
Reservierungen = 100 000. Die letzten 100 hat der Reaper **nach** dem Lastende
freigegeben, als kein Client mehr kaufen konnte. Alle Buchfuehrungs-Invarianten
sind gruen. Bei jedem Profil mit Denkzeit ist dieser Check strukturell flaky.

Umgekehrt greift dasselbe Gate am anderen Ende: `buy-only-full-speed` setzt die
Deadline auf 900 s und bekommt damit **gar keine** Sellout-, Reaper- und
Expiry-Invarianten — der Lauf, der tatsaechlich eine Million Tickets verkauft
hat, wurde am schwaechsten geprueft.

## 5. Befund: k6-Thresholds erreichen das Verdict nicht

Beide Full-Speed-Laeufe reissen `http_req_duration p(95) < 500ms` (876 ms bzw.
809 ms) und melden trotzdem `System result: pass`. Die Verdict-Logik
(`scripts/load-test/lib/validate.mjs:95-135`) liest ausschliesslich
Korrektheits-Invarianten; `failedRate`, `duration.*` und der k6-Exit-Code
werden weder ausgewertet noch gerendert.

## 6. Befund: Der Schreibpfad staut vor dem DB-Pool, nicht in Postgres

Am `buy-only`-Plateau steht der Pool auf seinen 50 Verbindungen bei **3 760
wartenden Acquirern** in der Spitze. Der `buy_ticket`-Timer umschliesst
`pg.Pool.query()`, das intern acquired — die 172,9 ms sind daher ueberwiegend
Wartezeit (~15 ms auf der Verbindung, ~158 ms in der Queue). Referenzwert ohne
Contention: 1,5 ms im `human-pace`-Lauf.

`connectionTimeoutMillis` ist nicht gesetzt, wartende Acquirer warten also
unbegrenzt. `PUBSUB_FLOW_CONTROL_MAX_MESSAGES=500` ist nur eine weiche Grenze
(`allowExcessMessages` steht per Default auf `true`); der harte Begrenzer ist
der Pool.

## 7. Messketten-Defekte, die diese Laeufe nicht beantworten koennen

- **`db_locks_waiting` ist blind fuer die hier zu erwartende Contention.** Der
  Gauge filtert auf `wait_event_type = 'Lock'`; die Fremdschluessel von
  `orders`/`tickets` nehmen aber zweimal je Aufruf `FOR KEY SHARE` auf
  dieselbe `events`-Zeile, was als MultiXact-SLRU-Druck unter `LWLock`
  erscheint. Der gemessene Wert 0 ist kein Freispruch.
- **`nodejs_eventloop_lag_*` hat die Last nie gesehen.** 10-ms-Aufloesung (der
  Boden ist die Abtastperiode selbst) und `histogram.reset()` in jedem
  Collect-Callback. Vor dem `buy-only`-Lauf mean 10,6 ms, danach 11,0 ms.
- **Histogramm-Buckets springen 1 → 2,5 → 5 s.** Im `buy-only`-Lauf liegen
  6,6 % der Orders im 1–2,5-s-Bucket und p95 wie p99 fallen hinein; die
  gemeldeten „2,500 s" heissen nur „irgendwo zwischen 1 und 2,5 s"
  (interpoliert: 1,36 s bzw. 2,27 s).
- **`tickets` hat keinen Index auf `order_id`.** Der Duplikat-Zweig von
  `buy_ticket` scannt damit sequenziell ueber ~1 Mio Zeilen. In diesen Laeufen
  ohne Wirkung (0 Redeliveries), unter Retry-Druck relevant.
- **Zwei `buy_ticket`-Overloads existieren in der DB.** Die alte
  3-Argument-Variante enthaelt noch den mit Migration 0009 entfernten
  `sold_count`-Hot-Row-Write. Der Worker ruft die 4-Argument-Variante; die
  alte wurde nie gedroppt.
