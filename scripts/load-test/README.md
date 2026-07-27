# Load-Test Report Automation (MVP)

Deterministic evidence collector + analyzer around the existing spike
orchestration. Implements the "Minimum viable automation" from
[`docs/suggested/LOAD-TEST-REPORT-AUTOMATION.md`](../../docs/suggested/LOAD-TEST-REPORT-AUTOMATION.md):
it calculates facts, applies **versioned** rules, and labels anything it cannot
prove — it does not guess a root cause.

## Commands

```bash
# Full run: preflight -> seed -> baseline snapshots -> phase A (reactive) +
# phase B -> drain -> final snapshots -> analysis -> report -> policy exit code.
# Requires a live local stack (Docker, built API/worker, k6, Prometheus).
pnpm spike:report

# Re-derive derived.json + report.md from an existing artifact directory ONLY
# (no network / DB). Lets reports be regenerated after template changes.
pnpm spike:analyze -- artifacts/load-tests/<run-id>

# Compare two runs; refuses a capacity claim unless capacity, profile, Git
# state, and candidate validity are compatible. Exits non-zero when not.
pnpm spike:compare -- <baseline-derived.json|dir> <candidate-derived.json|dir>

# Export every Grafana panel (title + legend) as PNG for a time window.
# Runs automatically at the end of `spike:report`; needs the renderer container.
pnpm spike:graphs                                   # last run, window from its manifest
pnpm spike:graphs -- --range '{"from":"2026-07-27 16:19:00","to":"2026-07-27 16:31:00"}'

# Pure unit + golden-file tests (no stack needed; also run in CI).
pnpm spike:report:test
```

## Layout

| Path                      | Responsibility                                                        |
| ------------------------- | --------------------------------------------------------------------- |
| `run-and-report.mjs`      | Orchestrator (side effects): the only part needing a live stack.      |
| `analyze-run.mjs`         | Pure: artifact dir → `derived.json` + `report.md`.                    |
| `compare-runs.mjs`        | Pure: two `derived.json` → comparison report.                         |
| `lib/openmetrics.mjs`     | Parse `/metrics` text; sum counters; reconstruct histograms.          |
| `lib/derive.mjs`          | Counter delta/reset, dropped share, histogram saturation, invariants. |
| `lib/validate.mjs`        | Benchmark-validity + system-result verdicts.                          |
| `lib/analyze.mjs`         | Compose artifacts → the full `derived` object.                        |
| `lib/render-markdown.mjs` | Byte-stable Markdown renderer (idempotent).                           |
| `lib/compare.mjs`         | Two-run compatibility checks + deltas.                                |
| `lib/manifest.mjs`        | Manifest shape + secret-redaction allowlist (**orchestrator** env).   |
| `lib/config.mjs`          | Policy/query loaders, Git/host info, preflight.                       |
| `lib/snapshots.mjs`       | PostgreSQL/Redis state via the container CLIs (read-only).            |
| `lib/prometheus.mjs`      | Prometheus instant query + target health.                             |
| `lib/drain.mjs`           | Drain monitor (`pending = Δpublished − Δcompleted − Δfailed`).        |
| `lib/processes.mjs`       | k6 phase spawning + reactive sell-out stop.                           |
| `lib/grafana.mjs`         | Panel discovery + `/render/d-solo` PNG export (ADR-030).              |
| `export-grafana.mjs`      | CLI around it: time window from flags or a run's manifest.            |
| `test/`                   | Unit tests + anonymized Baseline-A fixture and approved golden files. |

Policy/queries are versioned in [`load-tests/report-policy.json`](../../load-tests/report-policy.json)
and [`load-tests/report-queries.json`](../../load-tests/report-queries.json).
Raw run artifacts land under `artifacts/load-tests/<run-id>/` (gitignored); a
reviewed baseline is copied into `docs/reports/` by hand.

## Boundaries

- **Pure vs. side-effecting.** Everything except `run-and-report.mjs` and the
  `snapshots`/`prometheus`/`processes` collectors is pure and unit-tested.
- **No guesswork.** The analyzer separates observations, derived facts, and
  hypotheses; a plausible-but-uninstrumented root cause stays `inconclusive`.
- **Idempotent output.** Re-running `spike:analyze` over the same artifacts
  yields byte-identical `report.md` (no wall-clock timestamps).

## Zwei Konfigurations-Quellen (bewusst getrennt)

Der Report weist Konfiguration aus **zwei** Quellen aus, weil sie verschiedene
Dinge beschreiben:

- **Load harness / orchestrator env** (`manifest.configuration`, aus
  `redactConfig(process.env)`): formt die _Last_ — `LOAD_PROFILE`, `PAY_RATE`,
  `CANCEL_RATE`, `SALE_OPENS_IN_SECONDS`, k6-Knobs.
- **Effective service configuration** (`derived.serviceConfig`, aus dem
  `service_config_info`-Gauge in `/metrics`): das, womit API und Worker
  **tatsaechlich** liefen — `NODE_ENV`, `LOG_LEVEL`,
  `DISABLE_REQUEST_LOGGING`, und beim Worker zusaetzlich
  `PUBSUB_FLOW_CONTROL_MAX_MESSAGES`, `DATABASE_POOL_MAX`,
  `WORKER_RECONCILE_MODE`.

Vor dieser Trennung wies der Report die Orchestrator-Umgebung als
Messkonfiguration aus und behauptete dadurch `NODE_ENV=test`, obwohl beide
Services via `start:loadtest` unter `NODE_ENV=production` liefen (Baseline B,
Report §2). Ein Service, der den Gauge nicht exponiert, erscheint als `null` —
so bleiben aeltere Laeufe (Baseline A) ehrlich auswertbar statt falsch
beschriftet.
