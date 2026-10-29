# Themen- und Phasennotizen

Hier liegen Details, die ein Todo oder ADR gezielt verlinkt, aber keine
dauerhafte Systemwahrheit sind. Das verhindert lange Spezifikationen und
Umsetzungsberichte in `docs/TODO.md`.

## Ablage

| Verzeichnis | Inhalt                                                      |
| ----------- | ----------------------------------------------------------- |
| `phases/`   | Plan, Scope und Arbeitsstand einer benannten Phase          |
| `backlogs/` | phasenübergreifende Nachläufe und thematische Arbeitspakete |

Dateinamen: `phases/phase-<nummer>-<kebab-titel>.md`,
`backlogs/<kebab-thema>.md`. Ein Dokument behandelt genau ein unabhängig
lesbares Thema; es gibt keine chronologische Sammeldatei.

## Aufbau einer Phasennotiz

1. **Ziel und Scope** — was die Phase liefert und was nicht.
2. **Plan** — Reihenfolge, Abhängigkeiten, fällige Entscheidungen.
3. **Stand** — offene Fäden, nächster Schritt, Blocker. Wird am Ende jeder
   Sitzung überschrieben, nicht fortgeschrieben; die Historie steht in Git.

Vorlage: [Phase 0](phases/phase-0-grundlagen.md).

## Abgrenzung

- Gewünschtes Verhalten gehört in `docs/REQUIREMENTS.md`.
- Aktueller Datenfluss und Skalierung gehören in `docs/ARCHITECTURE.md`.
- Getroffene Entscheidungen mit Alternativen gehören als Einzel-ADR nach
  `docs/decisions/`.
- Messungen und Audits gehören nach `docs/reports/`.
- Im Todo bleibt nur eine kurze Zeile. Die Notiz einer Phase wird einmal unter
  der Phasenüberschrift verlinkt, nicht in jedem Todo wiederholt.

Eine Notiz bleibt erhalten, solange Todo oder ADR sie als Detailquelle nutzt.
Wird ihr Inhalt zur aktuellen Wahrheit, wird er in die zuständige Quelle
überführt und hier nicht zusätzlich gepflegt.

Die vollständige Routing-Regel steht in [`docs/DOCS.md`](../DOCS.md).
