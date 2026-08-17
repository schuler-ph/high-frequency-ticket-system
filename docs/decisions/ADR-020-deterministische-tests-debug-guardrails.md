# ADR-020: Deterministische Tests & Debug-Guardrails

- **Datum:** 2026-03-22
- **Kontext:** Unter Node 24 + `ts-node/esm` waren glob-basierte `node --test` Aufrufe in API/Worker wiederholt instabil (opaque Top-Level-Fehler), was die Fehlersuche verlangsamt hat. Gleichzeitig wurden wiederkehrende Diagnosen oft als Inline-Einzeiler ausgefuehrt und waren dadurch schwer reproduzierbar.
- **Entscheidung:**
  - Testskripte setzen `NODE_OPTIONS=''`, um Debug-Bootloader-Injektionen als Fehlerquelle zu eliminieren.
  - Wiederkehrende Diagnosen werden als versionierte Skripte bereitgestellt (`debug:*`, inkl. Migrations- und `buy_ticket`-Vertragschecks).
  - CI fuehrt Guardrail-Checks fuer Migrations-Journal und `buy_ticket`-Vertrag vor Lint/Typecheck/Build aus.
  - Ein kurzes Runbook dokumentiert den reproduzierbaren Debug-Ablauf.
- **Begruendung:** Versionierte Debug-Skripte sparen Debug-Zeit, da sie ad-hoc Shell-Einzeiler durch wiederholbare Checks ersetzen. Fruehe CI-Guardrails verhindern Drift zwischen Drizzle-Schema, Migrationsjournal und SQL-Function-Vertrag.
- **Alternativen:**
  - Bei ad-hoc Shell-Diagnosen bleiben und nur bei Bedarf manuell debuggen (langsamer, fehleranfaelliger).
  - Nur lokale Checks ohne CI-Guardrails (Drift wird spaet erkannt).
- **Status:** Fertig
- **TODO-Mapping:** `docs/TODO.md` Phase 1 (Debug-Skripte, Runbook) + Phase 3.1 (CI-Guardrails)

### Update 2026-04-21: Direkter Testpfad ohne Shared Runner

- **Kontext:** Der zwischenzeitliche Shared Runner fuer API und Worker hat die eigentliche Ursache der Test-Langsamkeit nicht geloest, sondern die Testarchitektur weiter verkompliziert.
- **Entscheidung:** API, Worker und `@repo/db` laufen wieder direkt ueber paketlokale `node --conditions=source --test` Skripte ohne Wrapper-Entrypoints oder zentrales Runner-Skript.
- **Begruendung:** Die direkte Paket-Ausfuehrung gegen native `.ts`-Quellen ist einfacher, erklaerbarer und schneller zu debuggen als jede zentrale Sonderlogik fuer Loader, Main-Module oder paketabhaengige Branches.
- **Umsetzung:**
  - `package.json`
  - `apps/api/package.json`
  - `apps/worker/package.json`
  - `packages/db/package.json`

### Update 2026-04-20: Schneller lokaler Testpfad ohne Coverage-Instrumentierung

- **Kontext:** Die vereinheitlichten Testskripte mit `c8` lieferten reproduzierbare Coverage-Berichte, waren im lokalen Entwicklungs-Loop aber deutlich langsamer als nötig.
- **Entscheidung:** Lokale Testläufe und Coverage/CI-Läufe werden getrennt:
  - `test` in API/Worker läuft ohne Coverage-Instrumentierung (schneller Feedback-Loop).
  - `test:coverage` und `test:ci` nutzen in API/Worker die native Node-Coverage.
  - `@repo/db` bleibt fuer Coverage und `test:ci` beim stabileren `c8`-Pfad.
  - Root-Skripte und Turborepo-Tasks erhalten ein separates `test:ci`-Target mit Coverage-Outputs.
- **Begruendung:** So bleibt die lokale Iteration schnell, während CI weiterhin Coverage-Artefakte und denselben vollständigen Sicherheits-Flow nutzt.
- **Umsetzung:**
  - `apps/api/package.json`
  - `apps/worker/package.json`
  - `package.json`
  - `turbo.json`

### Update 2026-04-20: Deterministisches Local Reset/Seeding fuer Infrastruktur

- **Kontext:** Fuer reproduzierbare lokale End-to-End-Tests fehlte ein einheitlicher One-Command-Reset ueber PostgreSQL, Redis und den Pub/Sub Emulator.
- **Entscheidung:** Ein zentrales Root-Skript, heute `pnpm seed`, setzt alle drei lokalen Systeme auf einen definierten Fixture-Stand zurueck.
- **Begruendung:** Einheitliche Ausgangsdaten reduzieren Debug-Zeit, verhindern Drift zwischen Teammitgliedern und verbessern die Reproduzierbarkeit von API/Worker-Tests.
- **Umsetzung:**
  - `scripts/local/reset.mjs`
  - `package.json`
  - damalige Kurzdatei `docs/DEBUGGING.md`, seit 2026-07-30 in
    `docs/RUNBOOK.md` konsolidiert
