# Phase 4.7: API-Performance-Dashboard — fehlende Order-Routen

Detailnotiz zum Nachtrag des API-Performance-Dashboards aus Phase 4.7
(bis zur TODO-Reorganisation 2026-08-14 als Phase 4.8 geführt).

### Phase 4.7: Nachtrag zum API-Performance-Dashboard

> > Nachtrag zum abgeschlossenen Phase-4.1-Todo „Grafana-Dashboard: API Performance" (`monitoring/grafana/provisioning/dashboards/api-performance.json`). Das Dashboard bricht bisher nur `/api/tickets/:eventId/buy` und `/api/tickets/:eventId/availability` einzeln auf; die Order-Routen `POST /api/orders/:orderId/pay` und `POST /api/orders/:orderId/cancel` fehlen als eigene Graphen, obwohl `http_request_duration_seconds` sie bereits per `route`-Label exponiert.

## Umsetzungsstand (2026-07-26)

Der Nachtrag wurde nicht als eigener Durchgang, sondern im Dashboard-Audit des
Baseline-C-Nachlaufs erledigt. → [Details](../backlogs/baseline-c-dashboard-audit.md#api-performance-eigene-panels-fuer-pay-und-cancel)

- `POST /pay RPS` und `POST /cancel RPS` liegen im Panel „Request Rate (RPS)".
- „POST /pay Latency (p50 / p95 / p99)" ist ein eigenes Panel in voller Breite.
  Seit ADR-028 ist `/pay` der publizierende Schreibpfad und unter Last der
  langsamste Schritt: p95 4,55 s im Crunch gegen 874 ms bei `/buy`.
- Ein eigenes `/cancel`-Latenzpanel entfaellt bewusst. „Latency by Route
  (p50 / p95)" deckt die Route generisch ab; ein zusaetzliches Panel bringt bei
  einem Event mehr Serien als Erkenntnis. Dieselbe Begruendung gilt fuer
  `GET /orders/:orderId`, solange `CHECKOUT_POLL=false` keinen Traffic erzeugt.
- Die Serien sind gegen die Baseline-C-Daten verifiziert; die `route`-Labels
  entsprechen den Fastify-Templates aus `apps/api/src/plugins/metrics.ts`, es
  gibt keinen Fallback auf Roh-URLs.

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

> `/pay` und `/cancel` fehlen im API-Performance-Dashboard als eigene Graphen. → [Details](#phase-47-nachtrag-zum-api-performance-dashboard)

Umgesetzt im Dashboard-Audit des Baseline-C-Nachlaufs. → [Umsetzungsstand](#umsetzungsstand-2026-07-26)

- [x] Request-Rate-Serien `POST /pay RPS` und `POST /cancel RPS` im Panel „Request Rate (RPS)".
- [x] Panel „POST /pay Latency (p50 / p95 / p99)" ergaenzt; Pay-p95 im Crunch 4,55 s gegen Buy 874 ms.
- [x] Kein eigenes `/cancel`-Latenzpanel — „Latency by Route (p50 / p95)" deckt es generisch ab, analog zum ebenfalls weggelassenen `GET /orders/:orderId`.
- [x] Serien gegen Baseline-C-Daten verifiziert; die `route`-Labels entsprechen den Fastify-Templates.
