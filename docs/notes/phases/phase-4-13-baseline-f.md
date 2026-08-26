# Phase 4.13: Baseline F — gueltiger Lauf je Profil

Abgeschlossene Detailnotiz zur Baseline F. Der Vorspann liegt in der Backlog-Notiz `baseline-f-valid-runs`, die Messung im Report. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

- [x] **Harness und System vorbereitet (A–D, 2026-08-25):** ADR-036, ADR-037, Lastform als Profilwerte, komprimierte Zeit, Buckets, Lock-Waits, Pool-Timeout, Index. → [Details](../backlogs/baseline-f-valid-runs.md#baseline-f-vorspann)
- [x] **Baseline F gefahren (2026-08-26):** drei Profile `system: pass`, `performance: pass`, exakter Sellout; `benchmark: degraded` — die API haengt bei 10k it/s an einem Core (~9k it/s Decke). Referenz fuer 5.6. → [Report](../../reports/baseline-f-2026-08-26/LOAD-TEST-REPORT-2026-08-26.md)
- [x] **`POST /pay` unter Contention:** p50/p95/p99 91 / 323 / 568 ms (E: 670 / 2 173 / 2 451) — Concurrency vor dem gesaettigten Core, keine Routen-Eigenschaft; Referenz in 5.6 verankert.
