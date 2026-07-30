# ADR-007: GitHub Actions für CI/CD

- **Datum:** 2026-02-24
- **Kontext:** Automatisierte Quality Gates (lint, typecheck, build) sind notwendig, um Code-Qualität im Monorepo sicherzustellen.
- **Entscheidung:** GitHub Actions mit Turborepo-Cache für lint, typecheck und build.
- **Begründung:** Native GitHub-Integration. Kostenlose Minuten für Open-Source-Repos. Turborepo-Cache beschleunigt CI-Runs erheblich.
- **Alternativen:** GitLab CI (anderer Hoster), Cloud Build (GCP-only Lock-in).

### Update 2026-04-19: Node-Kompatibilitaetsmatrix und primäre Test-Runtime

- **Kontext:** Das Projekt war bisher praktisch auf Node 24 festgelegt. Gewuenscht war eine explizite Kompatibilitaetsabsicherung fuer eine weitere LTS-Linie, ohne den stabilen Hauptpfad zu verwässern.
- **Entscheidung:**
  - CI-Quality-Gates (Guardrails, Lint, Typecheck, Build) laufen als Matrix auf Node 22 und Node 24.
  - Die komplette Test-Suite laeuft weiterhin auf Node 24 als primaerer Runtime.
  - Engine-Constraint im Root-Workspace wird auf `>=22` gesetzt.
- **Begruendung:** So wird echte Laufzeit-Kompatibilitaet frueh erkannt, waehrend der Haupttestpfad stabil und reproduzierbar auf der primären Runtime bleibt.
- **Umsetzung:**
  - `.github/workflows/ci.yml`
  - `package.json`
  - `docs/REQUIREMENTS.md`
  - damalige Kurzdatei `docs/DEBUGGING.md`, seit 2026-07-30 in
    `docs/RUNBOOK.md` konsolidiert
