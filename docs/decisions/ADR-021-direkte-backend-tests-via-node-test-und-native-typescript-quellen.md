# ADR-021: Direkte Backend-Tests via `node:test` und native TypeScript-Quellen

- **Datum:** 2026-04-21
- **Kontext:** Der bisherige lokale Testpfad fuer API und Worker war durch Shared Runner, `ts-node/esm`, spaeter `tsx` und einen diagnostischen Vitest-Zweig unnötig komplex. Die Testlogik selbst war schnell, aber Loader-, Worker- und Teardown-Pfade erzeugten wiederholt 15- bis 30-sekündige Ausreisser. Besonders problematisch waren Runtime-Importe fuer reine Typ-Symbole, Dist-Kopplung in `@repo/db` und parallele Root-Orchestrierung in CI-aehnlichen Umgebungen.
- **Entscheidung:** API, Worker und `@repo/db` fuehren ihre Backend-Tests paketlokal direkt ueber `node:test` gegen native `.ts`-Quellen mit `--conditions=source` aus. Relative Source-Imports werden als `.ts` gepflegt und beim Build per TypeScript auf `.js` umgeschrieben. Coverage nutzt fuer API und Worker den nativen Node-Test-Coverage-Pfad und bleibt fuer `@repo/db` beim stabileren `c8`-Pfad. Das lokale Root-Kommando `pnpm test` orchestriert die Paketskripte ueber Turborepo im Stream-Modus mit `--concurrency=1`.
- **Begruendung:** Diese Variante entfernt sowohl `tsx` als auch Vitest aus dem Backend-Test-Hot-Path, hält die Runtime maximal nah an produktivem Node.js und vermeidet Dist-Artefakt-Abhaengigkeiten fuer normale Testlaeufe. Die verbleibenden Fastify-Lifecycle-Smoke-Tests wurden aus den kritischen Backend-Pfaden entfernt beziehungsweise auf pure Funktionen reduziert, weil genau diese Mini-Suites die 15-Sekunden-Ausreisser erneut triggern konnten. Paketlokale Skripte bleiben direkt und nachvollziehbar; Root-Orchestrierung bleibt Aufgabe von Turborepo, nicht eines weiteren Test-Runners.
- **Alternativen:**
  - `ts-node/esm` mit Shared Runner (zu komplex und instabil)
  - `node --import tsx --test` (einfacher als `ts-node/esm`, aber weiterhin mit sporadischen 15-Sekunden-Teardown-Ausreissern)
  - vollstaendige Migration auf Vitest fuer Backend-Pakete (diagnostisch hilfreich, aber fuer diesen Scope kein stabilerer Fast-Path)
- **Umsetzung:**
  - `package.json`
  - `apps/api/package.json`
  - `apps/worker/package.json`
  - `packages/db/package.json`
  - `packages/typescript-config/base.json`
