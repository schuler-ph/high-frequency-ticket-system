# Phase 4.6: Baseline-C-Nachlauf (entdeckt 2026-07-26 abends)

Abgeschlossene Detailnotiz zum Baseline-C-Nachlauf. Korrektheit, Kapazitaet und Dashboard-Audit liegen in den verlinkten Backlog-Notizen. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

Aus dem Baseline-C-Lauf: die Messketten-Fixes des B-Nachlaufs haben gehalten, der Lauf legte echte System- und Dashboard-Defekte frei. → [Report](../../reports/baseline-c-2026-07-26/LOAD-TEST-REPORT-2026-07-26.md), [Vorspann](../backlogs/baseline-c-overview.md#backlog-baseline-c-nachlauf-vorspann)

Details: [baseline-c-correctness](../backlogs/baseline-c-correctness.md) · [baseline-c-capacity](../backlogs/baseline-c-capacity.md) · [local-generator-split](../backlogs/local-generator-split.md) · [baseline-c-dashboard-audit](../backlogs/baseline-c-dashboard-audit.md)

### P0 — Korrektheit

- [x] **Reconcile-Leseordnung umdrehen (Report §5):** DB-vor-Ledger-Read erfand Inventar (389 Ansprueche > Kapazitaet); jetzt Ledger vor DB, damit die Korrektur konservativ nach unten irrt. → ADR-022
- [x] **Drift-Gauge entklammern (Report §5):** `Math.max(…, 0)` machte `redis_db_drift_tickets` genau bei Ueberzeichnung blind; Klammer nur noch am Redis-Write, Metrik aus dem ungeklammerten Erwartungswert.

### P1 — Kapazitaet weitertreiben

- [x] **`DATABASE_POOL_MAX` erhöhen und neu messen:** Config erledigt (`start:loadtest` setzt Pool 50); der 2026-08-03-Lauf war generator-verzerrt, die gueltige Messung ist Teil des 4.12-Laufs.
- [x] **k6-`maxVUs` und Zielrate in Einklang bringen:** 5.000 VUs bei 10.000 Iterationen/s garantierten Verwerfungen rechnerisch; `maxVUs` auf 10.000 (deckt ~1 s Iterationsdauer).
- [x] **Transportfehler untersuchen:** Hypothese Host-Netzwerkgrenzen; wird durch den 4.12-Lauf mit getrenntem Generator entschieden — bleiben sie, folgt ein neues Todo.

### P2 — Dashboard-Audit (alle 8 Dashboards, 2026-07-26)

Leitfehler: Panels lasen Reserve als Publish. → [Vorspann](../backlogs/baseline-c-dashboard-audit.md#dashboard-audit-vorspann), [korrekt geprüft](../backlogs/baseline-c-dashboard-audit.md#dashboard-audit-als-korrekt-geprueft)

- [x] **`order-lifecycle`: Pending, Ratio und Counts** auf `payments_confirmed_total` korrigiert.
- [x] **`order-lifecycle`: „Checkout Abandon Rate" lieferte −7,33 %** — 5m-Fenster statt Lauf; jetzt `$__range` + `clamp_min`, live 12,1 % (modelliert 12 %).
- [x] **`pubsub-queue`: Publish Rate und Queue Depth** lasen `accepted` statt Publish und ueberschaetzten die Tiefe; `worker_duplicate_deliveries_total` fehlte.
- [x] **`api-performance`: `/pay` und `/cancel` ohne eigene Panels** — der Publish-Pfad war unsichtbar; RPS-Serien + Pay-Latenz-Panel ergaenzt (p95 4,55 s im Crunch).
- [x] **`api-performance`: Error Rate ignorierte `425`** (29.965 Warm-up-Versuche) und mischte die mehrdeutigen 409 global.
- [x] **`reservation-consistency`: „Current Drift" nutzte `abs()`** und verwarf das Vorzeichen — genau die Oversell-Information.
- [x] **`reservation_ledger_active`/`_stale` in keinem Dashboard:** das Reaper-Signal war unsichtbar, obwohl es 4,3 % des Inventars band; neues Panel.
- [x] **`worker-reliability`: Duplicate Deliveries fehlten,** Rate-Nenner war `accepted` statt `payments_confirmed`.
- [x] **`order-completion-latency`: Panel-Titel seit ADR-028 falsch** — gemessen wird Publish→Persist, nicht `/buy`→completed.
- [x] **`redis-performance`: „Memory Usage" plottete `redis_memory_max_bytes`** (ohne `maxmemory` konstant 0, sah wie ein Defekt aus) → Serie entfernt, bewusst kein `maxmemory`.
- [x] **`db-runtime`: Pool Wait/Lock Waits waren Momentaufnahmen** und zeigten nach dem Lauf 0 → `max_over_time([$__range])`; echter Peak 3.578 wartende Acquirer.
