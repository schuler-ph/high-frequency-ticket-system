# Architecture Decision Records

Dieser Index ist die Einstiegsebene. Lies für eine Aufgabe nur die verlinkten
ADRs, deren Entscheidung den betroffenen Bereich berührt. Neue Entscheidungen
erhalten eine eigene Datei unter `docs/decisions/`.

## Aktiv

- [ADR-001 Progressive Dokumentationsarchitektur](decisions/ADR-001-progressive-dokumentationsarchitektur.md)

## Teilweise umgesetzt

## Geplant

## Abgelöst

Der Status ist eine Navigationserleichterung, kein Ersatz für `docs/TODO.md`.
ADR-Inhalte bleiben historisch stabil; ein Richtungswechsel erhält einen neuen
superseding ADR.

## ADR-Konvention

Dateiname:
`docs/decisions/ADR-<NNN>-<kurzer-kebab-case-titel>.md`.

Ein neuer ADR enthält mindestens:

```text
# ADR-NNN: Titel

- Status: Geplant | Teilweise umgesetzt | Fertig | Abgelöst
- Datum: YYYY-MM-DD
- Ersetzt: ADR-NNN (optional)

## Kontext
## Entscheidung
## Begründung
## Alternativen
## Konsequenzen
```

Der Index enthält nur Titel, Link und Navigationsstatus. Arbeitszuordnung
bleibt in `docs/TODO.md`. Kleine Präzisierungen erhalten einen datierten
Nachtrag (`## Nachtrag YYYY-MM-DD: …`) im ADR; ein Richtungswechsel erhält
einen neuen ADR, der den alten explizit ablöst.
