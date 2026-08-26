# Phase 4: Interface & Testing

Abgeschlossene Detailnotiz zu den Lasttests aus Phase 4. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

## Lasttests (`load-tests/`)

### Reaktive Sold-Out-Erkennung im Lasttest

> - [x] Restrukturiere den lokalen Lasttest auf reaktive Sold-Out-Erkennung statt fixer Phasen-Timer: `spike-phase-a.js` (Warm-Up/Ramp-Up/Sustain) + `spike-phase-b.js` (Cool-Down), orchestriert durch `scripts/local/run-spike.mjs` (pollt Availability, stoppt Phase A per SIGINT bei bestaetigtem Sold-Out) (ADR-025) — behebt, dass Baseline A mitten im Peak statt am beabsichtigten Sold-Out-Uebergang endete.

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

### Frontend (`apps/web`)

- [x] Erstelle Grund-Layout der Next.js Landingpage (Frequency Festival Theme, Hero-Section).
- [x] Implementiere Komponente für dynamische Ticket-Verfügbarkeitsanzeige (Polling `GET /api/tickets/:eventId/availability`).
- [x] Implementiere Kaufen-Button mit Loading State und Error-Handling.
- [x] Verbinde den Kaufen-Button via Fetch mit `POST /api/tickets/:eventId/buy`.
- [x] Baue UI Feedback ein (Toast/Alert für Erfolg "In Warteschlange" vs. "Ausverkauft").

### Lasttests (`load-tests/`)

- [x] Initialisiere k6 Lasttest-Skript (`spike.js`) mit Basis-Struktur.
- [x] Definiere Ramp-Up Szenario im Skript (1k → 10k → 50k RPS, Sustained, Cool-Down).
- [x] Implementiere HTTP-Requests im k6-Skript (Availability checken, Tickets kaufen).
- [x] Fuehre den lokalen Baseline-A-Lasttest aus und dokumentiere Bottlenecks. → [Report](../../reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md)
- [x] Erzeuge Screenshots der Dashboards unter extremer Last fuer die README.
- [x] Sale-Unlock-Gate atomar in Redis umsetzen und im Seed konfigurierbar machen. → [ADR-024](../../decisions/ADR-024-sale-unlock-gate-425-too-early.md)
- [x] **Reaktive Sold-Out-Erkennung im Lasttest:** `spike-phase-a/b.js`, orchestriert von `run-spike.mjs` statt fixer Phasen-Timer — Baseline A endete sonst mitten im Peak. → ADR-025
- [x] Dokumentiere und implementiere die automatisierbare Evidence-/Report-Pipeline inkl. Validitaetsregeln und Artefaktvertrag (`scripts/load-test/README.md`).
