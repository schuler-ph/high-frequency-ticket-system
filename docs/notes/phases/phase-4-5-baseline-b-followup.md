# Phase 4.5: Baseline-B-Nachlauf (entdeckt 2026-07-26)

Abgeschlossene Detailnotiz zum Baseline-B-Nachlauf. Die Prioritaets-Details liegen in den verlinkten Backlog-Notizen. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

Folgearbeit aus Baseline B; P0 blockierte die Auswertung, P2 die Kapazitätsaussage. → [Details](../backlogs/baseline-b-overview.md#backlog-baseline-b-nachlauf-vorspann)

Details: [baseline-b-measurement-chain](../backlogs/baseline-b-measurement-chain.md) · [baseline-b-environment](../backlogs/baseline-b-environment.md) · [baseline-b-capacity](../backlogs/baseline-b-capacity.md) · [baseline-b-storage-review](../backlogs/baseline-b-storage-review.md)

### P0 — Messkette reparieren (sonst ist auch Baseline C nicht auswertbar)

- [x] **Drain-Formel auf Publish umstellen:** `payments_confirmed_total` statt Reserve-Counter.
- [x] **`dbTickets == completed` redelivery-tolerant machen:** Erst-Finalisierung und Duplikate getrennt zählen.
- [x] **Fehlende Counter-Baseline behandeln:** `resolveCounter` im Analyzer statt DB-Read in der API.

### P1 — Messumgebung

- [x] **Prometheus stirbt am k6-Remote-Write (Report §4.1):** Remote-Write ist jetzt opt-in (`K6_PROMETHEUS_RW`) und im Default aus — der Report liest ohnehin keine k6-Serien.
- [x] **Config-Snapshot aus den Services statt aus dem Orchestrator (Report §2):** neuer Gauge `service_config_info`; der Report weist Harness- und effektive Service-Config getrennt aus.
- [x] **Plateau-Detektor gegen Host-Contention haerten (Report §4.5):** das Plateau wird gegen den Rest-Bestand klassifiziert — `available == 0` → `sold-out`, sonst `stalled`. → ADR-025

### P2 — Kapazitaet

- [x] **Baseline C erst nach P0/P1 fahren.** Superseded 2026-08-14: der Lauf erfolgte 2026-07-26 abends (benchmark-invalid, 21,85 % dropped); der gueltige Lauf lebt in Phase 4.12.

### Beobachtung fuer das Storage-Review (Phase 6)

- [x] **Datenbasis aus Baseline B in das Storage-Review einspeisen:** nach Phase 6 verschoben — das Storage-Review-Todo verlinkt die Datenbasis jetzt direkt.
