# ADR-001: Progressive Dokumentationsarchitektur

- **Status:** Fertig
- **Datum:** {{DATUM}}

## Kontext

Agenten arbeiten in getrennten Chats mit begrenztem Kontext. Wenn der Start
einer Sitzung verlangt, alle Projektdokumente vollständig zu lesen, wächst der
Startkontext mit jeder Woche, und veraltete Details überstimmen die aktuelle
Aufgabe. Umgekehrt geht Wissen verloren, wenn Fortschritt, offene Fäden und
Begründungen nur im Chat stehen.

## Entscheidung

1. `AGENTS.md` ist die kurze kanonische Agent-Anweisung. `CLAUDE.md` (und bei
   Bedarf `.github/copilot-instructions.md`) sind Symlinks darauf.
2. Agenten laden Projektdokumente selektiv nach Aufgabe; `docs/DOCS.md`
   definiert die verbindliche Routing-Tabelle.
3. `REQUIREMENTS.md` beschreibt Soll-Verhalten, `ARCHITECTURE.md` nur den
   Ist-Zustand, `TODO.md` ist ein Arbeitsindex mit einzeiligen Todos in Phasen.
4. `DECISIONS.md` ist ein kleiner Link-Index; jede Entscheidung liegt als
   eigene Datei unter `docs/decisions/`.
5. Längere Pläne und der Arbeitsstand einer Phase liegen in Notizen unter
   `docs/notes/`, Messungen in `docs/reports/`, Umsetzungsdetails in Git.
6. `scripts/check-docs.mjs` erzwingt Links, Anker, Indexabdeckung, Symlinks und
   Größenbudgets.

## Begründung

Ein Agent braucht zu Beginn Regeln und eine Landkarte, nicht die gesamte
Projektgeschichte. Progressive Offenlegung hält die Startkosten konstant,
während die Gesamtdoku wachsen darf. Weil jede Sitzung ihren Stand in Todo und
Phasennotiz hinterlässt, kann jederzeit ein neuer Chat beginnen. Der
maschinelle Check ist nötig, weil eine reine Textregel das schleichende
Wachstum einzelner Dateien nicht aufhält.

## Alternativen

- **Alles bei jedem Start vollständig laden:** einfach, aber mit unbeschränktem
  Kontextwachstum und sinkender Aufmerksamkeit für einzelne Regeln.
- **Eine große Wiki-Datei:** gute Volltextsuche, aber keine klare Ownership und
  keine selektive Ladegrenze.
- **Wissen nur in Git-Commits:** kleinster Working Tree, aber Begründungen und
  Arbeitsstand wären nicht gezielt auffindbar.

## Konsequenzen

- Neue Dokumenttypen oder Ablageorte werden zuerst in `docs/DOCS.md` begründet.
- Skills und Agentprofile dürfen keine pauschalen Voll-Leseanweisungen
  einführen.
- Sitzungen enden mit gepflegtem Todo und aktualisiertem „Stand" der
  Phasennotiz.
