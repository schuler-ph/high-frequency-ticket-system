# Baseline F — Lasttest-Report 2026-08-26

Lokale Referenz-Baseline für Phase 5.6 (REQ-D03/REQ-D05 Stufe 1). Drei Profile
auf einem Commit (`6e2687b`, Zwei-Maschinen-Setup: k6 auf dem Ryzen-PC via
ssh, SUT allein auf dem MacBook), plus ein Kontrolllauf (`a9c42f3`) mit
größerem Generator-Budget. Die deterministisch erzeugten Reports liegen unter
[`generated/`](generated/), die Rohartefakte unter
`artifacts/load-tests/2026-08-26T*` (gitignoriert, nur lokal).

## Ergebnis in einem Satz

**Das System ist korrekt und schnell genug, der Nachweis der 10k-RPS-Zielrate
ist auf einem API-Core nicht möglich.** Alle drei Läufe: `system: pass` (alle
Invarianten inklusive Sellout, Reaper und Expiry), `performance: pass`
(p95 < 500 ms), exakter Ausverkauf per `stopReason: sold-out`, 0 Fehler,
0 Rollbacks, 0 Redeliveries, Drift 0. Alle drei: `benchmark: degraded`, weil
der Generator Iterationen verwerfen musste — nicht aus eigener Schwäche, sondern
weil der API-Prozess bei 10k Kauf-Iterationen/s an genau einem Core hängt.

## Läufe

| Lauf (Commit `6e2687b`)     | Kapazität | it/s ausgeführt | dropped         | VUs aktiv / Deckel | http p95 | `/pay` p50/p95/p99 | Transport-Fehler | Benchmark  | System | Perf. |
| --------------------------- | --------- | --------------- | --------------- | ------------------ | -------- | ------------------ | ---------------- | ---------- | ------ | ----- |
| `browse-and-buy-full-speed` | 1 000 000 | 9 009           | 21 389 (0,36 %) | 5 777 / 16 000     | 228 ms   | 91 / 323 / 568 ms  | 43               | `degraded` | pass   | pass  |
| `buy-only-full-speed`       | 1 000 000 | 3 954 (Ziel 5k) | 29 557 (2,40 %) | 10 000 / 10 000    | 392 ms   | —                  | 15 640 (buy)     | `degraded` | pass   | pass  |
| `browse-and-buy-human-pace` | 100 000   | 8 486           | 14 468 (0,40 %) | 3 679 / 10 000     | 16 ms    | —                  | 0                | `degraded` | pass   | pass  |

Kontrolllauf (Commit `a9c42f3`, `browse-and-buy-full-speed` mit
`K6_PREALLOCATED_VUS=8000`, `somaxconn=1024`): 8 680 it/s, **263 219 dropped
(4,28 %)**, 16 000 / 16 000 VUs, http p95 **1 667 ms** (`performance: fail`),
80 116 Transportfehler — alle `connectex … did not properly respond`
(Connect-Timeouts), 10–20k je Minute ausschließlich in der Verkaufsphase.

Gegenüber Baseline E (2026-08-18): p95 876 → 228 ms (full-speed), 809 → 392 ms
(buy-only), `/pay` p99 2 451 → 568 ms; der falsche `system: fail` von
human-pace ist behoben (Sellout-Gate am Abbruchgrund, ADR-035 Nachtrag); die
komprimierte Zeit (6 s Denkzeit, 12 s Deadline, Reaper alle 6 s, ADR-037) übt
Ablauf, Reaper und 410-Expired aus und verkauft 100k in ~7 Minuten aus.

## Befund: die Single-Core-Decke

Panel „Process CPU (cores, rate)", Dashboard DB & Runtime:

| Lauf                      | API-CPU Plateau | API-CPU Max | Worker Max |
| ------------------------- | --------------- | ----------- | ---------- |
| full-speed (Runde 1)      | 1,01–1,02       | **1,02**    | 0,41       |
| buy-only                  | 0,92 → 1,04     | **1,04**    | 0,67       |
| full-speed (Kontrolllauf) | 1,04–1,05       | **1,05**    | 0,36       |

Ein Node-Prozess nutzt einen Core; die API klebt in allen Full-Speed-Läufen an
dieser Decke. Der Durchsatz ist in Runde 1 und Kontrolllauf praktisch gleich
(9 009 gegen 8 680 it/s) — der Server liefert dasselbe, unabhängig davon, wie
viel Concurrency der Generator anbietet. Was sich ändert, ist nur, **wo die
Warteschlange sitzt**:

- kleiner effektiver VU-Deckel (Runde 1: 5 777 aktive VUs) → k6 verwirft
  Iterationen (0,36 %), die Latenz bleibt bei 228 ms;
- großer VU-Deckel (Kontrolllauf: 16 000 aktive VUs) → k6 verwirft mehr
  (4,28 %) **und** die Latenz explodiert (1 667 ms), weil 16k Anfragen vor
  einem gesättigten Kern warten (Little's Law).

Die 15-s-Spitzen in `http_req_connecting` und die Connect-Timeouts sind die
Form, in der eine gesättigte Event-Loop auf der Generatorseite erscheint: sie
schafft `accept()` nicht mehr, SYNs bleiben unbeantwortet. Ein größerer
Listen-Backlog (`kern.ipc.somaxconn` 128 → 1024) ändert daran nichts — der
Kontrolllauf lief mit 1024. Human-pace (95 % Reads, API weit unter einem Core)
hatte 0 Stalls.

**Lokale Decke: ~9k Kauf-Iterationen/s (≈13k RPS mit Availability-Reads) bei
p95 < 500 ms auf einem API-Core.** Ein Open-Loop-Generator oberhalb der Decke
liefert immer `degraded`. `valid` gibt es lokal nur unterhalb der Decke
(`K6_TARGET_RATE` ≈ 8 000) oder mit mehreren API-Prozessen.

## Was das für Phase 5 heißt

- **Referenz für 5.6** ist Runde 1 (`browse-and-buy-full-speed`, 9 009 it/s,
  p95 228 ms, `degraded` 0,36 %): die Cloud muss mit einer API-Replica dieselbe
  Kurve zeigen, mit N Replicas darüber liegen.
- **Kapazität ist horizontal** (Phase 5.2: N API-Replicas hinter Ingress). Die
  10k RPS aus REQ-P01 sind das Ziel für diese Topologie, nicht für einen Prozess.
- **Generator-Knöpfe sind ausgereizt:** `K6_MAX_VUS`, `K6_PREALLOCATED_VUS`
  und der Backlog verschieben nur die Warteschlange. Die Profile stehen auf den
  Werten der Referenzläufe.
- **Messkette:** alle drei Verdicts sind aussagekräftig (ADR-036), das k6-Log
  liegt seit dem Kontrolllauf im Artefakt (`k6/phase-*.log`), die Bucket-Leiter
  1–5 s ist aufgelöst (ADR-023 Nachtrag). Weitere Läufe in Phase 4 gibt es
  nicht; die Messkette wird in der Cloud mit einem kleinen Smoke-Profil geprüft.

## Belege

- Deterministische Reports: [`generated/browse-and-buy-full-speed.md`](generated/browse-and-buy-full-speed.md),
  [`generated/buy-only-full-speed.md`](generated/buy-only-full-speed.md),
  [`generated/browse-and-buy-human-pace.md`](generated/browse-and-buy-human-pace.md),
  [`generated/browse-and-buy-full-speed-runde-2.md`](generated/browse-and-buy-full-speed-runde-2.md).
- Grafana-Panels (64 je Lauf) und k6-Summaries/-Logs: `artifacts/load-tests/2026-08-26T10-18-42-094Z-6e2687b`,
  `…T10-35-15-726Z-6e2687b`, `…T10-43-55-628Z-6e2687b`, `…T11-30-03-246Z-a9c42f3` (lokal).
- Herleitung, Entscheidungen und Fehlannahmen: [Baseline-F-Notiz](../../notes/backlogs/baseline-f-valid-runs.md).
