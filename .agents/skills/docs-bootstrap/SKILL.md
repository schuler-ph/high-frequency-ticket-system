---
name: docs-bootstrap
description: Richtet in einem neuen oder bestehenden Projekt die progressive Docs-as-Code-Struktur ein — kurze AGENTS.md mit CLAUDE.md-Symlink, docs/DOCS.md als Router, TODO.md als Arbeitsindex mit Phasen, REQUIREMENTS/ARCHITECTURE/RUNBOOK, ADR-Einzeldateien mit Index, notes/ und reports/ plus ein maschineller Doku-Check. Use when der Nutzer ein Projekt "doku-fertig" aufsetzen, CLAUDE.md/AGENTS.md nach Best Practice anlegen, Doku aufteilen, Kontext klein halten, Sitzungen übergeben oder bestehende Projektdoku in diese Struktur migrieren will.
---

Ziel: Ein Agent kann jeden neuen Chat mit wenig Kontext beginnen und trotzdem
nahtlos weiterarbeiten. Dafür hat jeder Fakt genau einen Ort, der Startkontext
ist ein Router statt einer Pflichtlektüre, und ein Skript verhindert, dass die
Struktur schleichend wieder zum Monolithen wird.

Die Vorlagen liegen neben dieser Datei unter `templates/` und spiegeln 1:1 die
Zielstruktur im Projektroot. Das Prüfskript liegt in den Vorlagen unter
`templates/scripts/check-docs.mjs`.

## Zielstruktur

```text
AGENTS.md                         kanonische Agent-Anweisung (kurz, nur Regeln + Routing)
CLAUDE.md -> AGENTS.md            Symlink für Claude Code
.github/copilot-instructions.md   optionaler Symlink -> ../AGENTS.md für Copilot
README.md                         Landingpage und Quickstart für Menschen
docs/DOCS.md                      Router: welche Datei besitzt welche Wahrheit
docs/TODO.md                      Arbeitsindex: Phasen, eine Zeile pro Todo
docs/REQUIREMENTS.md              Soll-Verhalten mit stabilen IDs (REQ-…)
docs/ARCHITECTURE.md              Ist-Zustand: Datenfluss, Ownership, Skalierung
docs/RUNBOOK.md                   ausführbare Abläufe: Setup, Betrieb, Diagnose
docs/DECISIONS.md                 ADR-Index nach Status + ADR-Konvention
docs/decisions/ADR-NNN-titel.md   eine Datei pro Entscheidung
docs/notes/README.md              Abgrenzung der Notizablagen
docs/notes/phases/                Detailplan je Phase inkl. "Stand" für die Übergabe
docs/notes/backlogs/              phasenübergreifende Themenpakete
docs/reports/                     unveränderliche Messungen, Audits, Analysen
.agents/skills/plan-next-task/    Einstiegs-Workflow für jeden neuen Chat
scripts/check-docs.mjs            Links, Anker, ADR-Index, Budgets, Symlinks
```

## Ablauf

### 1. Bestandsaufnahme (nur lesen)

- Prüfe, ob es bereits `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/` oder
  andere Agent-Dateien (`.cursorrules`, `.github/copilot-instructions.md`,
  `.agents/`, `.claude/`) gibt. Lies sie, bevor du etwas anlegst.
- Ermittle aus Manifest und Skripten (`package.json`, `pyproject.toml`,
  `Cargo.toml`, `go.mod`, `Makefile`, CI-Workflows) Stack, Paketmanager und die
  echten Validierungsbefehle (Format, Lint, Typecheck, Test).
- Ermittle Doku-Sprache: Sprache des Nutzers bzw. vorhandener Doku. Die
  Vorlagen sind deutsch; bei englischem Projekt übersetzt du sie beim Anlegen
  vollständig (auch Überschriften, damit Anker konsistent bleiben).
- Prüfe, ob Node ≥ 20 verfügbar ist (`node --version`). Ohne Node entfällt nur
  das Prüfskript, nicht die Struktur.

### 2. Nur das Nicht-Ableitbare fragen

Frage gebündelt in einer Rückfrage und nur, was du nicht aus Repo oder Anfrage
ableiten kannst:

- Projektzweck in einem Satz.
- Nicht verhandelbare Regeln (Architekturgrenzen, verbotene Muster, Dinge, die
  ein Agent nie eigenständig tun darf).
- Welche Agenten im Einsatz sind (Claude Code, Codex, Copilot, Cursor) — davon
  hängen die Symlinks ab.
- Bei leerem Projekt: grobe erste Phasen, falls schon bekannt.

Alles andere bekommt einen sinnvollen Default; offene Lücken landen als Todo in
Phase 0, nicht als weitere Frage.

### 3. Struktur anlegen

1. Kopiere den Inhalt von `templates/` in den Projektroot. Überschreibe keine
   bestehende Datei; bei Konflikt gilt Schritt 4.
2. Ersetze alle Platzhalter `{{…}}`. Pflicht: `{{PROJEKTNAME}}`,
   `{{PROJEKTZWECK}}`, `{{DATUM}}` (heute, `YYYY-MM-DD`),
   `{{VALIDIERUNG}}` (echte Befehle aus Schritt 1). Abschnitte, die mit
   `<!-- Beispiel: … -->` markiert sind, an das Projekt anpassen oder
   entfernen. Am Ende darf `grep -rn '{{' AGENTS.md README.md docs scripts .agents`
   nichts mehr finden.
3. Lege die Symlinks an (relativ, damit sie im Repo funktionieren):

   ```bash
   ln -s AGENTS.md CLAUDE.md
   ```

   ```bash
   mkdir -p .github && ln -s ../AGENTS.md .github/copilot-instructions.md
   ```

   Nur die Symlinks anlegen, deren Agent im Einsatz ist, und
   `CONFIG.agentSymlinks` in `scripts/check-docs.mjs` genau darauf abstimmen.
   Auf Windows ohne Symlink-Rechte stattdessen `CLAUDE.md` mit dem einzigen
   Inhalt `@AGENTS.md` anlegen und den Eintrag aus `agentSymlinks` entfernen.

4. Damit Claude Code die Projekt-Skills findet, verlinke sie:

   ```bash
   mkdir -p .claude/skills && ln -s ../../.agents/skills/plan-next-task .claude/skills/plan-next-task
   ```

5. Passe `CONFIG.backtickPathPrefixes` in `scripts/check-docs.mjs` an die
   Top-Level-Verzeichnisse des Projekts an (z. B. `src`, `apps`, `packages`).

### 4. Bestehende Doku migrieren (nur wenn vorhanden)

Bestehender Text wird umsortiert, nicht neu erfunden und nicht gelöscht:

| Inhalt der Altdoku                              | Ziel                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| dauerhafte Regeln für Agenten                   | `AGENTS.md` (kurz halten)                        |
| Projekterklärung, Quickstart                    | `README.md`                                      |
| gewünschtes Verhalten, Akzeptanzkriterien       | `docs/REQUIREMENTS.md` mit REQ-IDs               |
| wie das System heute aufgebaut ist              | `docs/ARCHITECTURE.md`                           |
| "wir haben X statt Y gewählt, weil…"            | je ein ADR unter `docs/decisions/` + Indexzeile  |
| offene Aufgaben, Roadmap                        | `docs/TODO.md` (eine Zeile je Todo)              |
| lange Todo-Beschreibungen, Pläne, Zwischenstand | `docs/notes/phases/` oder `docs/notes/backlogs/` |
| Befehlsfolgen, Setup, Fehlersuche               | `docs/RUNBOOK.md`                                |
| Messwerte, Benchmarks, Audits                   | `docs/reports/`                                  |
| Liste geänderter Dateien, "heute erledigt"      | Git-Historie — nicht übernehmen                  |

War die alte `CLAUDE.md` eine echte Datei, wird ihr Inhalt nach dieser Tabelle
verteilt und die Datei danach durch den Symlink ersetzt. Unklare Passagen
wandern wortgleich in eine thematische Notiz statt verloren zu gehen. Vor dem
Löschen oder Ersetzen einer bestehenden Datei den Nutzer fragen.

### 5. Prüfskript verdrahten

- Mit `package.json`: Skript `"docs:check": "node scripts/check-docs.mjs"`
  ergänzen und, falls es ein Sammel-Skript wie `verify` oder `lint` gibt, dort
  anhängen.
- Ohne `package.json`: Make-Target oder Task-Runner-Eintrag, sonst den direkten
  Aufruf `node scripts/check-docs.mjs` in Runbook und `AGENTS.md` nennen.
- Falls CI existiert: denselben Aufruf als Schritt ergänzen. Keine neue CI
  anlegen, wenn es keine gibt — dann als Todo in Phase 0 eintragen.

### 6. Verifizieren

1. `node scripts/check-docs.mjs` ausführen und alle Fehler beheben.
2. Platzhalter-Grep aus Schritt 3 ist leer.
3. `ls -l CLAUDE.md` zeigt den Symlink auf `AGENTS.md`.
4. Vorhandenen Formatter über die neuen Markdown-Dateien laufen lassen.
5. Kurze Zusammenfassung an den Nutzer: angelegte Dateien, getroffene Defaults,
   offene Phase-0-Todos. Commit nur, wenn der Nutzer es wünscht.

## Regeln, die die Vorlagen verkörpern

Nicht abschwächen, wenn du die Vorlagen anpasst:

1. **Ein Fakt, eine Quelle.** Andere Dokumente verlinken, statt zu kopieren.
2. **Ist, Soll, Arbeit, Begründung getrennt:** ARCHITECTURE, REQUIREMENTS,
   TODO, ADR.
3. **Git ist das Änderungsprotokoll.** Keine Dateilisten oder
   Umsetzungserzählungen in langlebigen Dokumenten.
4. **Startkontext ist ein Router.** `AGENTS.md` enthält keine
   Projekterklärung und keinen pauschalen "lies alles"-Befehl.
5. **Große Themen sind einzeln adressierbar:** ein ADR pro Entscheidung, eine
   Notiz pro Phase oder Thema, ein Report pro Messung.
6. **TODO.md ist ein Index.** Ein Todo ist eine Zeile; Phasen werden von oben
   nach unten gelesen, eine neue Phase kommt direkt hinter die aktive.
   Abgeschlossene Todos werden nicht umgeschrieben; Folgearbeit ist ein neuer
   Eintrag.
7. **Nichts Wichtiges lebt nur im Chat.** Vor dem Ende einer Sitzung stehen
   Fortschritt im Todo, offene Fäden im Abschnitt "Stand" der Phasennotiz und
   neue Entscheidungen als ADR.
8. **Grenzwerte stehen nur im Skript.** Doku beschreibt den Zweck der
   Backstops, dupliziert aber keine Zahlen.
