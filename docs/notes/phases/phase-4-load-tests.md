# Phase 4: Interface & Testing

Abgeschlossene Detailnotiz zu den Lasttests aus Phase 4. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

## Lasttests (`load-tests/`)

### Reaktive Sold-Out-Erkennung im Lasttest

> - [x] Restrukturiere den lokalen Lasttest auf reaktive Sold-Out-Erkennung statt fixer Phasen-Timer: `spike-phase-a.js` (Warm-Up/Ramp-Up/Sustain) + `spike-phase-b.js` (Cool-Down), orchestriert durch `scripts/local/run-spike.mjs` (pollt Availability, stoppt Phase A per SIGINT bei bestaetigtem Sold-Out) (ADR-025) — behebt, dass Baseline A mitten im Peak statt am beabsichtigten Sold-Out-Uebergang endete.
