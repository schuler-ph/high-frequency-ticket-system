# ADR-032: Progressive Dokumentationsarchitektur

- **Status:** Fertig
- **Datum:** 2026-07-30

## Kontext

Die Repository-Anweisung verlangte zu Beginn jeder Entwicklungs- oder
Architekturaufgabe das vollständige Lesen von `REQUIREMENTS.md`, `TODO.md`,
`DECISIONS.md` und `ARCHITECTURE.md`. Diese vier Dateien waren zusammen rund
196 KB groß. Der größte Anteil entstand durch einen monolithischen ADR-Log
(105 KB) und eine Architekturdatei, die Ist-Zustand, Zielbilder, Lasttest und
Workspace-Inventar vermischte.

Die vollständige Markdown-Historie zeigt 185 Commits mit Doku-Änderungen.
`TODO.md` wurde besonders häufig als Fortschrittsprotokoll verwendet;
ADR-029 begrenzte dieses Wachstum, leitete Entscheidungsdetails aber weiterhin
in einen einzigen wachsenden ADR-Monolithen. Zusätzlich duplizierten
`.agents/rules/rules.md`, Copilot-Agentprofile und Skills den pauschalen
Lesebefehl.

## Entscheidung

1. `AGENTS.md` ist die kurze kanonische Repository-Anweisung. `CLAUDE.md` und
   `.github/copilot-instructions.md` sind Symlinks darauf.
2. Agenten laden Projektdokumente selektiv nach Aufgabe. `docs/DOCS.md`
   definiert die verbindliche Routing-Tabelle.
3. `REQUIREMENTS.md` beschreibt das gewünschte Verhalten, `ARCHITECTURE.md`
   ausschließlich den aktuellen Systemaufbau und `TODO.md` den Arbeitsindex.
4. `DECISIONS.md` wird zum kleinen, nach Status gruppierten Link-Index. Jede ADR
   liegt als eigene Datei unter `docs/decisions/`; Todo-Mappings bleiben im
   Arbeitsindex und werden nicht dupliziert.
5. Historische Implementierungsdetails leben in Git, Reports oder gezielt
   verlinkten Themen-/Phasennotizen und werden nicht in aktuelle Quellen der
   Wahrheit kopiert.
6. `pnpm run debug:docs` erzwingt Symlink-Ziele, Indexabdeckung, Links und
   Größenbudgets für automatisch oder häufig geladene Dokumente.

## Begründung

Ein Agent braucht zu Beginn Regeln und eine Landkarte, nicht die gesamte
Projektgeschichte. Progressive Offenlegung reduziert Startkosten und verhindert,
dass veraltete Details die aktuelle Aufgabe überstimmen. Einzelne ADRs bleiben
vollständig auffindbar, ohne bei jeder unabhängigen Änderung Kontext zu
verbrauchen. Maschinelle Backstops verhindern, dass die Struktur schleichend
wieder zum Monolithen wird.

## Alternativen

- **Alle vier Dateien weiter vollständig laden:** einfach, aber mit
  unbeschränktem Kontextwachstum und sinkender Aufmerksamkeit für einzelne
  Regeln.
- **Nur größere Modellkontexte verwenden:** verschiebt die Grenze, beseitigt
  weder Duplikation noch veraltete Aussagen.
- **Ein einziges großes Wiki-Dokument:** gute Volltextsuche, aber keine klare
  Ownership oder selektive Ladegrenze.
- **ADRs nur über Git-Commits dokumentieren:** kleinster Working Tree, aber
  Begründungen und verworfene Alternativen wären schwer gezielt auffindbar.

## Konsequenzen

- Neue Dokumenttypen oder Ablageorte müssen in `docs/DOCS.md` begründet werden.
- Agentprofile und Skills dürfen keine pauschalen Voll-Leseanweisungen
  wiedereinführen.
- Änderungen an der aktuellen Architektur müssen geplante und historische
  Beschreibungen aktiv aus `ARCHITECTURE.md` fernhalten.
- Die ADR-Gesamtheit wächst weiter, der automatisch geladene oder überflogene
  Index jedoch nicht proportional im Detailgrad.

## Nachtrag 2026-07-30: Ablage präzisiert

- `AGENTS.md` bleibt die einzige kanonische Agent-Anweisung. Codex liest sie
  nativ; `CLAUDE.md -> AGENTS.md` und
  `.github/copilot-instructions.md -> ../AGENTS.md` liefern denselben Inhalt
  an Claude und GitHub Copilot. Der Doku-Check prüft Ziel und Typ der Symlinks.
- Das monolithische `docs/TODO-ARCHIVE.md` wird durch direkt verlinkte Dateien
  unter `docs/notes/phases/` und `docs/notes/backlogs/` ersetzt. Die
  Detailtexte bleiben erhalten, müssen aber nicht gemeinsam geladen werden.
- Das Runbook liegt mit der übrigen Projektdokumentation unter
  `docs/RUNBOOK.md`. Die weitgehend doppelte Debugging-Kurzdatei ist darin
  konsolidiert.
- `README.md` bleibt Landingpage und Quickstart. Vollständige Abläufe, API- und
  Architekturdetails liegen in ihren zuständigen Quellen.
- Numerische Größen-Backstops sind ausführbarer Testcode und werden nur in
  `scripts/debug/check-docs.mjs` gepflegt. `docs/DOCS.md` beschreibt ihren
  Zweck, dupliziert aber keine Werte.
