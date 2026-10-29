# Architektur

Diese Datei beschreibt den **aktuellen Ist-Zustand** am Repository-HEAD:
Komponenten, Datenflüsse, Zuständigkeiten, Invarianten und Skalierungsgrenzen.
Geplante Änderungen stehen in [`docs/TODO.md`](TODO.md), Begründungen im
ADR-Index [`docs/DECISIONS.md`](DECISIONS.md).

Was hier steht, muss mit dem Code übereinstimmen. Zielbilder, Roadmaps und
Messergebnisse gehören nicht hierher.

## Systemgrenzen

<!-- Beispiel: Komponenten, externe Systeme und wer mit wem spricht; gern als Mermaid-Diagramm. -->

{{SYSTEMGRENZEN}}

## Datenbesitz und Invarianten

<!-- Beispiel: Welche Komponente besitzt welche Daten? Was muss immer gelten? -->

{{DATENBESITZ}}

## Zentrale Abläufe

<!-- Beispiel: je Kernablauf ein Unterabschnitt mit nummerierten Schritten. -->

{{ABLAEUFE}}

## Skalierung und Grenzen

{{SKALIERUNG}}
