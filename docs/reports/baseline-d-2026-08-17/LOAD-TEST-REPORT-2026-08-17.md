# Baseline D — Erster Zwei-Maschinen-Lasttest 2026-08-17

> Nachtrag 2026-08-19: umbenannt von „Baseline C (Split)" zu Baseline D; das
> Verzeichnis hiess bis dahin `baseline-c-split-2026-08-17`. Messwerte und
> Befunde sind unveraendert. Der offene Transportfehler-Befund aus §4 ist in
> [Baseline E](../baseline-e-2026-08-18/LOAD-TEST-REPORT-2026-08-18.md) geklaert.

Run-ID: `2026-08-17T19-36-50-348Z-8feefc9`
Commit: `8feefc9` (`main`)
Kommando: `K6_RUNNER=ssh K6_SSH_HOST=schul@10.0.0.2 K6_REMOTE_DIR=C:/hts K6_REST_URL=http://10.0.0.2:6565 BASE_URL=http://10.0.0.1:10002 HTS_ENV_PROFILE=capacity pnpm spike:report`
Rohartefakte: [`artifacts/`](./artifacts/) (lokal, gitignoriert) · deterministischer Report: [`artifacts/generated-report.md`](./artifacts/generated-report.md)

---

## 1. Kurzfassung

Erster Lauf mit getrenntem Lastgenerator (Phase 4.12): k6 v2.0.0 auf dem
Ryzen 5800X3D (Windows, via ssh + REST-Stop), SUT allein auf dem MacBook M3,
verbunden über einen 1-GbE-Direktlink (`10.0.0.1` ↔ `10.0.0.2`, kein Router,
kein WLAN).

| Frage                                | Antwort                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Benchmark-Gültigkeit                 | ⚠️ `degraded` — 3,10 % dropped iterations (über der Warnschwelle, unter der 5-%-Invalid-Grenze) |
| System-Ergebnis                      | ✅ `pass` — alle 5 Invarianten grün, Drift 0, Capacity-Delta 0, Drain in 15 s                   |
| Ausverkauf                           | ✅ echt (`stopReason: sold-out`, `available = 0`), 1 000 000 Kapazität in ~6:09 min Workload    |
| REQ-P01 (5k RPS sustained)           | übertroffen **mit Vorbehalt**: ~8 050 ausgeführte Iterationen/s, ~10 896 HTTP-req/s             |
| Generator-Contention ggü. 2026-08-03 | 3,10 % dropped statt 57,9 % — der Split wirkt                                                   |

## 2. Last & Latenz (Phase A)

- Iterationen: 2 952 332 ausgeführt, 96 302 dropped (3,10 % von 3 048 634 geplant), maxVUs 10 000
- HTTP: 3 995 871 Requests, ~10 896 req/s
- `http_req_duration`: med 140 ms, avg 224 ms, **p95 783 ms** (Threshold `p(95)<500` gerissen), max 13,9 s
- Stop: Sold-out-Plateau, zugestellt über die k6-REST-API (`PATCH /v1/status`), k6-Exit 103 mit vollständigem Summary-Export — exakt wie im 1-VU-Checkpoint verifiziert

## 3. Buchführung

- 1 087 032 Reservierungen, 956 507 completed = published = dbOrders = dbTickets, 87 032 storniert, 0 failed
- 43 493 offene Ansprüche am Ende = Abandon-Kohorte (hält bis zur 900-s-Deadline; `available = 0` ist im capacity-Profil damit ein echter Sellout)
- `available 0 + tickets 956 507 + active 43 493 == 1 000 000` → Delta 0, kein Oversell
- E2E-Latenz (Worker): mean 0,136 s, p95 0,5 s, p99 1,0 s

## 4. Befund: Transportfehler bleiben — Hypothese widerlegt

Die Host-Contention-Hypothese aus Phase 4.6 („Transportfehler verschwinden
mit getrenntem Generator") ist **widerlegt**: auch über den Direktlink bleiben
sie in derselben Größenordnung und sitzen fast vollständig auf dem Buy-Bein —
erstmals zuordenbar dank der Endpunkt-Sub-Metriken (Phase 4.12 Teil A):

| Phase   | Total   | buy    | availability |
| ------- | ------- | ------ | ------------ |
| phase-a | 113 470 | 94 598 | 18 872       |
| phase-b | 23 976  | 23 976 | 0            |

Kandidaten für die Ursache: k6-Timeouts/Resets im Sell-out-Crunch (p95 lag bei
783 ms, max 13,9 s), der USB-Ethernet-Adapter am MacBook, oder eine echte
API-Grenze. → eigenes Todo in Phase 4.12.

## 5. Einordnung der 3,10 % dropped

`generator-saturated`-Regel des Analyzers: Die Zielrate (10k) darf nicht als
Backend-Kapazität zitiert werden — zitierbar sind die ~8 050 ausgeführten
Iterationen/s. Für eine `valid`-Baseline wäre eine niedrigere Zielrate oder
ein höheres VU-Budget auf dem Generator der nächste Hebel.
