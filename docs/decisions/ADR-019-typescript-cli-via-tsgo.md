# ADR-019: TypeScript CLI via tsgo

- **Datum:** 2026-03-21
- **Kontext:** Monorepo-Builds und Typechecks laufen bisher ueber `tsc` und zeigen bei Full-Runs vermeidbare Laufzeitkosten. Das Projekt nutzt bereits `@typescript/native-preview` und will die Compiler-CLI schrittweise auf `tsgo` migrieren.
- **Entscheidung:** Direkte `tsc`-Aufrufe in Workspace-Skripten werden weitgehend durch `tsgo` ersetzt (`build`, `check-types`, Teile von `test` und `watch`).
- **Begruendung:** `tsgo` ist kompatibel zum bisherigen CLI-Flow und reduziert die Dauer von uncacheten Full-Builds. Die Umstellung erfolgt inkrementell, um Risiko in Dev-Watch-Flows klein zu halten. Eine temporaere Ausnahme bleibt fuer `apps/web` `check-types`, weil Side-Effect-CSS-Imports (`./globals.css`) im aktuellen Preview-Stand noch nicht sauber aufgeloest werden.
- **Alternativen:**
  - Bei `tsc` bleiben (kein Performance-Gewinn in CLI-Builds).
  - Big-Bang-Migration inklusive aller Watch/Restart-Workflows (hoeheres Integrationsrisiko).
- **Status:** Teilweise fertig
- **TODO-Mapping:** `docs/TODO.md` Phase 1 Tooling (`tsc`-CLI weitgehend migriert, Ausnahmen fuer Web-Checktypes und `tsc-watch` offen)

### Update 2026-04-21: Konsistenter Runtime-Packaging-Pfad fuer Shared-Pakete

- **Kontext:** Gebaute Artefakte von API und Worker importierten zur Laufzeit weiterhin `@repo/env` und `@repo/types` ueber Workspace-TypeScript-Quellen. Das funktionierte im lokalen Node-24-Pfad, war aber inkonsistent zum bereits buildbaren `@repo/db`-Paket und hielt gebaute Services implizit von Source-Exports abhaengig.
- **Entscheidung:** `@repo/env` und `@repo/types` werden als buildbare `tsgo`-Pakete mit `types`/`source`/`default`-Exports an das bestehende `@repo/db`-Muster angeglichen. Direkte `api`- und `worker`-Builds bauen ihre benoetigten Runtime-Pakete vor dem eigenen Service-Build explizit mit.
- **Begruendung:** Der source-basierte Test-Hot-Path bleibt unveraendert, waehrend gebaute Services einen konsistenten Plain-Node-Runtime-Pfad ueber `dist` erhalten. Das reduziert implizite TypeScript-Runtime-Abhaengigkeiten und vereinheitlicht das Verhalten aller Shared-Packages, die in Backend-Artefakten zur Laufzeit importiert werden.
- **Umsetzung:**
  - `packages/env/package.json`
  - `packages/types/package.json`
  - `apps/api/package.json`
  - `apps/worker/package.json`
  - `docs/REQUIREMENTS.md`
  - `docs/ARCHITECTURE.md`
  - `docs/TODO.md`
