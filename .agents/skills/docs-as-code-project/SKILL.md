---
name: docs-as-code-project
description: Setzt ein Projekt mit Docs-as-Code auf und haelt REQUIREMENTS, TODO, ARCHITECTURE und DECISIONS/ADRs konsistent mit dem Code.
---

Nutze diesen Skill, wenn ein Projekt von Anfang an dokumentationsgetrieben aufgebaut oder ein bestehendes Projekt auf einen stabilen Docs-as-Code-Workflow umgestellt werden soll.

## Ziel

Baue eine belastbare Dokumentations-Basis, in der Produktziele, Architektur, Entscheidungen und Umsetzungsfortschritt immer synchron zum Code bleiben.

## Pflicht-Dokumente (Minimum)

1. `docs/REQUIREMENTS.md`
2. `docs/TODO.md`

## Erweiterte Dokumente (stark empfohlen)

1. `docs/ARCHITECTURE.md`
2. `docs/DECISIONS.md` (ADR-Log)

## Standardstruktur

```text
docs/
  REQUIREMENTS.md
  TODO.md
  ARCHITECTURE.md
  DECISIONS.md
```

## Arbeitsweise (immer in dieser Reihenfolge)

1. Kontext laden

- Lies zuerst alle vier Dateien (`REQUIREMENTS`, `TODO`, `ARCHITECTURE`, `DECISIONS`), bevor du Code schreibst.
- Behandle `TODO.md` als operative Single Source of Truth fuer den Umsetzungsstand.
- Behandle `DECISIONS.md` als rationale Single Source of Truth fuer Architekturentscheidungen.

2. REQUIREMENTS sauber schneiden

- Definiere Scope, Zielbild, Lastszenario, Nicht-Ziele und Architekturrestriktionen.
- Halte Technologievorgaben explizit und testbar fest (z. B. Framework, Runtime, Package-Manager, DTO-Strategie).
- Ergaenze neue Technologien sofort, wenn sie eingefuehrt werden.

3. TODO in kleine, reviewbare Inkremente schneiden

- Organisiere in Phasen (z. B. Foundation, Core Logic, Hardening, Observability, Deployment).
- Formuliere Tasks atomar und abhakbar.
- Markiere erledigte Punkte sofort und ergaenze Folgeaufgaben dort, wo neue Erkenntnisse entstehen.

4. Architektur visualisieren und aktuell halten

- Nutze Mermaid fuer Diagramme direkt in Markdown (`flowchart`, Sequenzfluesse, Datenfluss).
- Ergaenze pro Kern-Flow eine nummerierte Schrittfolge (Happy Path + Failure Path).
- Verlinke Komponenten auf konkrete Workspace-Bereiche (apps, packages, infra).
- Optional fuer Praesentation: Draw.io als Quelle pflegen und SVG exportieren.

5. ADR-Disziplin durchziehen

- Jede nicht-triviale Entscheidung bekommt ein ADR mit: Kontext, Entscheidung, Begruendung, Alternativen.
- Fuehre Status (`Fertig`, `Teilweise fertig`, `Geplant`) und mappe auf offene/erledigte TODO-Tasks.
- Dokumentiere spaetere Updates als zeitgestempelte ADR-Ergaenzungen statt alte Texte still zu ueberschreiben.

6. Traceability sichern

- Jede groessere Code-Aenderung spiegelt sich in mindestens einem der Docs wider.
- Wenn Verhalten geaendert wurde, aktualisiere zuerst `ARCHITECTURE`/`DECISIONS`, dann `TODO`.
- Halte Beispiele und Endpunkte in Docs konsistent mit der Realitaet im Code.

## Allgemeine Learnings und Techniken (projektunabhaengig)

1. Doku als aktiver Teil der Entwicklung

- Dokumentation ist kein Nachtrag, sondern Teil jedes Arbeitspakets.
- Jede relevante Codeaenderung zieht mindestens ein Doku-Update nach sich.
- Der aktuelle Projektstand muss in Dokumenten jederzeit nachvollziehbar sein.

2. Struktur vor Detailtiefe

- Zuerst stabile Kapitelstruktur festlegen, dann Inhalte iterativ verfeinern.
- Anforderungen, Aufgaben, Architektur und Entscheidungen klar voneinander trennen.
- Pro Dokument eine klare Rolle definieren, um Redundanz zu vermeiden.

3. Nachvollziehbarkeit von Entscheidungen

- Nicht-triviale Entscheidungen immer mit Kontext und Alternativen dokumentieren.
- Spaetere Anpassungen als nachvollziehbare Updates ergaenzen.
- Entscheidungen mit konkreten Umsetzungsaufgaben verknuepfen.

4. Visuelle Kommunikation

- Diagramme direkt in Markdown pflegen, damit sie versionierbar und reviewbar bleiben.
- Pro kritischem Flow sowohl Happy Path als auch Failure Path dokumentieren.
- Diagramme, Text und reale Systemgrenzen muessen inhaltlich konsistent sein.

5. Operative Pflege im Alltag

- Aufgabenlisten klein, atomar und testbar formulieren.
- Erledigt-Status sofort aktualisieren, damit Planung und Realitaet nicht auseinanderlaufen.
- Regelmaessige Doku-Reviews in den Entwicklungsfluss integrieren.

## ADR-Mini-Template

```md
## ADR-XXX: Titel

- Datum: YYYY-MM-DD
- Kontext: Warum ist die Entscheidung noetig?
- Entscheidung: Was wurde beschlossen?
- Begruendung: Warum genau so?
- Alternativen: Was wurde verworfen und warum?
- Status: Geplant | Teilweise fertig | Fertig
- TODO-Mapping: Referenz auf relevante Punkte in docs/TODO.md
```

## Definition of Done fuer Docs-as-Code

Ein Arbeitspaket gilt erst als fertig, wenn:

1. Der Code laeuft und ist getestet.
2. `docs/TODO.md` den neuen Stand korrekt widerspiegelt.
3. Architektur-Aenderungen in `docs/ARCHITECTURE.md` nachgezogen sind (inkl. Mermaid, falls Flow geaendert).
4. Nicht-triviale Entscheidungen als ADR in `docs/DECISIONS.md` dokumentiert sind.
5. `docs/REQUIREMENTS.md` neue globale Vorgaben oder Technologien enthaelt.

## Typische Fehler, die dieser Skill verhindert

- Dokumentation nur am Projektanfang schreiben und danach veralten lassen.
- TODO-Listen als Wunschliste ohne echten Status nutzen.
- Architekturdiagramme ohne Bezug zu realen Flows pflegen.
- Entscheidungen ohne Begruendung treffen (fehlende ADR-Historie).
- Typ- und API-Vertraege in Tests lokal nachbauen und dadurch Type-Drift erzeugen.
