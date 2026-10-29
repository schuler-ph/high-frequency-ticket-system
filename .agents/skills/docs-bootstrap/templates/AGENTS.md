# Repository-Anweisungen

{{PROJEKTZWECK}}

## Kontext gezielt laden

Lies nicht pauschal die gesamte Projektdokumentation. Beginne mit der Anfrage,
dem relevanten Code und den direkt verlinkten Dokumenten. Nutze
[`docs/DOCS.md`](docs/DOCS.md) als Router:

- Aufgabenwahl oder Fortschritt: aktive Phase in `docs/TODO.md` und deren Notiz.
- Gewünschtes Systemverhalten: relevante Requirements aus `docs/REQUIREMENTS.md`.
- Aktueller Datenfluss oder Aufbau: relevante Abschnitte aus `docs/ARCHITECTURE.md`.
- Begründung einer Entscheidung: erst `docs/DECISIONS.md`, dann nur die verlinkte ADR-Datei.
- Setup, Betrieb oder Diagnose: relevanter Ablauf aus `docs/RUNBOOK.md`.

Lade ein Dokument vollständig nur, wenn die Aufgabe seinen gesamten Scope
betrifft. Git-Historie, Reports und Notizen sind Bedarfsquellen, kein
Startkontext.

## Sitzungen beginnen und übergeben

- Ein neuer Chat startet mit dieser Datei, dann mit der aktiven Phase in
  `docs/TODO.md` (die erste Phase mit offenen Todos) und dem Abschnitt
  „Stand" ihrer Phasennotiz. Der Workflow dafür ist `/plan-next-task`.
- Vor dem Ende einer Sitzung lebt nichts Wichtiges nur im Chat: erledigte
  Todos abhaken, offene Fäden und nächste Schritte in „Stand" der
  Phasennotiz, neue Entscheidungen als ADR.

## Nicht verhandelbare Projektregeln

<!-- Beispiel: durch echte Projektregeln ersetzen. Nur Regeln, deren Bruch teuer ist. -->

- **{{REGEL_TITEL}}:** {{REGEL}}
- **Keine riskanten Aktionen ohne Freigabe:** Deployments, Datenlöschungen
  und kostenpflichtige Läufe brauchen eine ausdrückliche, aktuelle Freigabe.
  Ein Todo oder Implementierungsauftrag ist keine Freigabe.

## Code- und Änderungsstil

- Änderungen klein halten und vorhandene Projekt-Skripte vor
  Ad-hoc-Befehlen bevorzugen.
- Architektur, Requirements und ADRs nur aktualisieren, wenn sich deren
  jeweilige Wahrheit tatsächlich ändert. Keine Implementierungsprotokolle in
  langlebige Dokumente kopieren.

## Dokumentationsregeln

- `docs/TODO.md` ist ein Arbeitsindex, kein Protokoll. Ein Todo bleibt eine
  kurze Zeile und verlinkt längere Details.
- Die Phasen in `docs/TODO.md` sind der rote Faden und werden von oben nach
  unten gelesen. Eine neue Phase wird direkt nach der aktuell aktiven Phase
  eingefügt und fortlaufend nummeriert — nie ans Dateiende hinter noch offene
  spätere Phasen gehängt.
- Abgeschlossene Todos werden nicht umgeschrieben oder wieder geöffnet.
  Folgearbeit kommt in einen neuen Eintrag am Ende der passenden Phase.
  Längere Phasen- oder Backlog-Details liegen thematisch unter `docs/notes/`.
- Neue nicht-triviale Entscheidungen erhalten eine eigene Datei unter
  `docs/decisions/` und einen Eintrag in `docs/DECISIONS.md`.
- Aktuelle Architektur beschreibt Ist-Zustand, Datenfluss, Zuständigkeiten und
  Skalierung. Pläne gehören in Todo oder Notizen, Messergebnisse in Reports.
- Ablage und Lebenszyklus stehen verbindlich in `docs/DOCS.md`; Links,
  Budgets und Symlinks prüft `node scripts/check-docs.mjs`.

## Validierung

```bash
{{VALIDIERUNG}}
node scripts/check-docs.mjs
```
