# Dokumentationsarchitektur

Diese Datei ist der Router für die Projektdokumentation. Sie definiert, welche
Datei welche Wahrheit besitzt und wann sie gelesen wird. Details werden nur
für die konkrete Aufgabe geladen.

## Grundsätze

1. **Ein Fakt hat eine Quelle der Wahrheit.** Andere Dokumente verlinken
   dorthin, statt denselben Inhalt zu pflegen.
2. **Ist, Soll, Arbeit und Begründung bleiben getrennt.** Architektur beschreibt
   den aktuellen Aufbau, Requirements das gewünschte Verhalten, Todo die Arbeit
   und ADRs die Entscheidungen.
3. **Git ist das Änderungsprotokoll.** Dateilisten, Testläufe und
   Implementierungserzählungen gehören nicht in langlebige Dokumente.
4. **Startkontext ist ein Router.** `AGENTS.md` enthält nur dauerhafte Regeln;
   alle weiteren Quellen werden nach Bedarf geöffnet.
5. **Große Themen sind einzeln adressierbar.** Ein ADR pro Entscheidung, eine
   Notiz pro Phase oder Backlog-Thema und ein Report pro Messung.
6. **Nichts Wichtiges lebt nur im Chat.** Jede Sitzung hinterlässt ihren Stand
   in Todo, Phasennotiz oder ADR, damit der nächste Chat ohne Verlust beginnt.

## Quellen der Wahrheit

| Dokument               | Verantwortlich für                                             | Nicht verantwortlich für                      | Lesen, wenn                                   |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `README.md`            | Einstieg, Projektzweck, Quickstart und Dokumentationslinks     | vollständige API, Architektur oder Bedienung  | jemand das Projekt kennenlernt                |
| `AGENTS.md`            | verbindliche Repository-Regeln und Kontext-Routing             | Projekterklärung und Historie                 | ein Agent im Repository arbeitet              |
| `docs/REQUIREMENTS.md` | gewünschtes funktionales und nichtfunktionales Systemverhalten | Technologiebegründung und Umsetzungsstatus    | Verhalten oder Akzeptanz betroffen sind       |
| `docs/ARCHITECTURE.md` | aktueller Datenfluss, Ownership, Invarianten und Skalierung    | Zielpläne, Roadmap und Messergebnisse         | Systemgrenzen oder Datenfluss betroffen sind  |
| `docs/DECISIONS.md`    | ADR-Navigation und ADR-Konvention                              | vollständige Entscheidungen und Arbeitsstatus | eine Entscheidung angelegt oder gesucht wird  |
| `docs/decisions/*.md`  | Kontext, Entscheidung, Alternativen und Konsequenzen           | allgemeiner Projektstatus                     | genau diese Entscheidung relevant ist         |
| `docs/TODO.md`         | priorisierter Arbeitsindex mit kurzen Einträgen                | Spezifikationen und Umsetzungsberichte        | Arbeit gewählt oder Fortschritt geändert wird |
| `docs/RUNBOOK.md`      | ausführbare Entwicklungs-, Betriebs- und Diagnoseabläufe       | Architekturbegründungen                       | ein konkreter Ablauf ausgeführt wird          |

Die Tabelle ist eine Zuständigkeitsgrenze, keine Pflichtlektüre. Ein
Requirement kann beispielsweise auf einen ADR verweisen, kopiert dessen
Begründung aber nicht.

`CLAUDE.md` (und optional `.github/copilot-instructions.md`) sind Symlinks auf
`AGENTS.md`, damit jeder Agent dieselbe Anweisung liest. Begründung:
[ADR-001](decisions/ADR-001-progressive-dokumentationsarchitektur.md).

## Bedarfswissen

| Ort                    | Zweck                                                      | Lebenszyklus                                                                  |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `docs/notes/phases/`   | Detailplan, Scope und Arbeitsstand einer Phase             | behalten, solange Todo oder ADR darauf verweisen; aktuelle Wahrheit auslagern |
| `docs/notes/backlogs/` | Details zu phasenübergreifenden Arbeitspaketen             | wie Phasennotizen; nach Thema teilen, nicht chronologisch sammeln             |
| `docs/reports/`        | unveränderliche Messungen, Audits, Analysen und Benchmarks | behalten; Korrekturen als datierten Nachtrag oder neuen Report                |
| lokale `README.md`     | Bedienung eines Verzeichnisses, Pakets oder Werkzeugs      | zusammen mit dem lokalen Code pflegen                                         |
| `.agents/skills/`      | wiederverwendbare Agent-Workflows                          | Projektwissen nur verlinken, nicht kopieren                                   |

Ein neuer Ablageort wird erst hier eingetragen und begründet, bevor er benutzt
wird.

## Selektiv lesen

Ein neuer Agent-Chat beginnt mit `AGENTS.md`. Danach:

1. Anfrage, Diff und lokale `README.md` bestimmen den Scope.
2. Für eine Aufgabe nur die aktive Phase in `docs/TODO.md`, deren Phasennotiz
   (Abschnitt „Stand") und die Links des gewählten Todos lesen.
3. In Requirements und Architektur nur betroffene Abschnitte öffnen.
4. Eine Entscheidung erst im ADR-Index suchen und dann nur passende ADRs lesen.
5. Weitere Notizen, Reports und Git-Historie nur für konkrete Details oder
   Belege laden.

Ein vollständiges Dokument ist nur bei einem Review seines gesamten Scopes,
einer Querschnittsmigration oder einer expliziten Doku-Prüfung nötig.

## Richtig schreiben

- Neue oder geänderte Systemfähigkeit: Requirement.
- Geänderter Ist-Datenfluss, Ownership oder Skalierung: Architektur.
- Nicht triviale Wahl mit Alternativen: neue ADR-Datei plus Indexeintrag.
- Aktueller Plan oder längerer Todo-Kontext: Phasen- oder Backlog-Notiz; im
  Todo bleibt eine kurze Zeile.
- Arbeitsstand am Sitzungsende (offene Fäden, nächster Schritt, Blocker):
  Abschnitt „Stand" der Phasennotiz, den alten Stand dabei ersetzen.
- Neue Phase in `docs/TODO.md`: direkt nach der aktuell aktiven Phase
  einfügen und fortlaufend nummerieren, nie ans Dateiende.
- Noch unentschiedener größerer Entwurf: thematische Notiz.
- Messung oder Untersuchungsergebnis: Report.
- Geänderte Dateien und ausgeführte Tests: Commit-Body oder Chat-Zusammenfassung.
- Bedienung eines lokalen Werkzeugs: dessen lokale `README.md`.

Dokumentation ändert sich im selben Change wie die Wahrheit. Reine
Implementierungsdetails benötigen keine Doku-Änderung, wenn Verhalten,
Architektur und Entscheidung gleich bleiben.

Die ADR-Vorlage und Statusregeln stehen in
[`docs/DECISIONS.md`](DECISIONS.md#adr-konvention).

## Pflege

Bei Doku-Änderungen:

1. Quelle und Ablage anhand dieses Routers wählen.
2. Doppelte oder historisch gewordene Aussagen entfernen.
3. Direkte Links auf den kleinsten relevanten Abschnitt setzen.
4. `node scripts/check-docs.mjs` ausführen.

Der Check prüft Links, Anker, ADR-Indexabdeckung, Todo-Kompaktheit,
Agent-Symlinks und Größen-Backstops. Die ausführbaren Grenzwerte stehen nur in
`scripts/check-docs.mjs`; diese Datei dupliziert sie bewusst nicht.
