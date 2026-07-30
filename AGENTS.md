# Repository-Anweisungen

Dieses Repository implementiert ein asynchrones High-Concurrency-Ticket-System
für das Frequency Festival in St. Pölten.

## Kontext gezielt laden

Lies nicht pauschal die gesamte Projektdokumentation. Beginne mit der Anfrage,
dem relevanten Code und den direkt verlinkten Dokumenten. Nutze
[`docs/DOCS.md`](docs/DOCS.md) als Router:

- Aufgabenwahl oder Fortschritt: relevante Abschnitte aus `docs/TODO.md`.
- Gewünschtes Systemverhalten: relevante Requirements aus `docs/REQUIREMENTS.md`.
- Aktueller Datenfluss oder Skalierung: relevante Abschnitte aus `docs/ARCHITECTURE.md`.
- Begründung einer Entscheidung: erst `docs/DECISIONS.md`, dann nur die verlinkte ADR-Datei.
- Betrieb oder Diagnose: relevanter Ablauf aus `docs/RUNBOOK.md`.

Lade ein Dokument vollständig nur, wenn die Aufgabe seinen gesamten Scope
betrifft. Git-Historie, Reports und Notizen sind Bedarfsquellen, kein
Startkontext.

## Nicht verhandelbare Systemregeln

- **Fastify only:** kein Express und keine Express-Patterns.
- **Asynchrone DB-Writes:** Die API schreibt nie direkt nach PostgreSQL.
  Kauf-Writes laufen über Pub/Sub und den Worker.
- **Redis-Reads:** API-Read-Modelle für Verfügbarkeit und Order-Status kommen
  aus Redis, nicht aus PostgreSQL.
- **Zentrale Verträge:** Request-, Response- und Event-Typen aus Zod-Schemas in
  `packages/types` ableiten; keine lokalen DTO-Duplikate.
- **Drizzle-Inferenz:** Datenbanktypen mit `$inferSelect` und `$inferInsert`
  ableiten; keine parallelen manuellen Typen.
- **Schema anwenden:** Nach Änderungen in `packages/db` sowohl generieren als
  auch `pnpm --filter @repo/db run db:push` gegen die Ziel-DB ausführen und den
  Effekt in PostgreSQL verifizieren.
- **Frontend:** Tailwind CSS verwenden; keine CSS Modules oder
  Styled-Components.
- **Tooling:** ausschließlich pnpm; Workspace-Abhängigkeiten mit `workspace:*`.
- **Lasttests nie eigenständig starten:** `pnpm spike`, `pnpm spike:report`,
  direkte `k6`-Läufe und andere Last-/Kapazitätstests brauchen eine
  ausdrückliche, aktuelle Freigabe für genau diesen Lauf. Ein Todo, ein
  Phasenabschluss oder ein Implementierungsauftrag ist keine Freigabe. Ohne
  Freigabe nur bestehende Artefakte lesen und die Kommandos zur manuellen
  Ausführung nennen.

## Code- und Änderungsstil

- TypeScript strict, ESM und keine `any`-Typen.
- Umgebungsvariablen über das zentrale Zod-Schema validieren.
- Fehler über typed errors und Fastify Error Handler behandeln; kein
  kontextloses `try/catch`.
- Änderungen klein halten und vorhandene Repository-Skripte vor
  Ad-hoc-Befehlen bevorzugen.
- Architektur, Requirements und ADRs nur aktualisieren, wenn sich deren
  jeweilige Wahrheit tatsächlich ändert. Keine Implementierungsprotokolle in
  langlebige Dokumente kopieren.

## Dokumentationsregeln

- `docs/TODO.md` ist ein Arbeitsindex, kein Protokoll. Ein Todo bleibt eine
  kurze Zeile und verlinkt längere Details.
- Abgeschlossene Todos werden nicht umgeschrieben oder wieder geöffnet.
  Folgearbeit kommt in einen neuen Eintrag am Ende. Längere Phasen- oder
  Backlog-Details liegen thematisch unter `docs/notes/`.
- Neue nicht-triviale Entscheidungen erhalten eine eigene Datei unter
  `docs/decisions/` und einen Eintrag in `docs/DECISIONS.md`.
- Aktuelle Architektur beschreibt Ist-Zustand, Datenfluss, Zuständigkeiten und
  Skalierung. Pläne gehören in Todo oder Notizen, Messergebnisse in Reports.
- Ablage und Lebenszyklus stehen verbindlich in `docs/DOCS.md`; maschinelle
  Grenzen und Links werden durch `pnpm run debug:docs` geprüft.

## Validierung

```bash
pnpm format:check
pnpm lint
pnpm check-types
pnpm test
pnpm verify:quick
pnpm verify:all
```

Vor `pnpm test`, `pnpm dev` oder Live-Checks müssen `hts-postgres`,
`hts-redis` und `hts-pubsub` laufen. Mit `docker compose ps` prüfen und bei
Bedarf `docker compose up -d` starten.
