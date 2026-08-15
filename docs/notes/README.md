# Themen- und Phasennotizen

Hier liegen Details, die ein Todo oder ADR gezielt verlinkt, aber keine
dauerhafte Systemwahrheit sind. Das verhindert lange Spezifikationen und
Umsetzungsberichte in `docs/TODO.md`.

## Ablage

| Verzeichnis | Inhalt                                                       |
| ----------- | ------------------------------------------------------------ |
| `phases/`   | Plan, Scope und unterstützende Details einer benannten Phase |
| `backlogs/` | phasenübergreifende Nachläufe und thematische Arbeitspakete  |

Ein Dokument behandelt genau ein unabhängig lesbares Thema. Große Nachläufe
werden nach Stage oder Priorität geteilt; es gibt keine chronologische
Sammeldatei.

## Abgrenzung

- Gewünschtes Verhalten gehört in `docs/REQUIREMENTS.md`.
- Aktueller Datenfluss und Skalierung gehören in `docs/ARCHITECTURE.md`.
- Getroffene Entscheidungen mit Alternativen gehören als Einzel-ADR nach
  `docs/decisions/`.
- Messungen und Audits gehören nach `docs/reports/`.
- Im Todo bleibt nur eine kurze Zeile. Die Notizen einer Phase stehen einmal
  unter der Phasenüberschrift — im Vorspann oder als eigene `Details:`-Zeile.
  Ein einzelnes Todo verlinkt nur dann zusätzlich seinen Abschnitt, wenn die
  Phasenzeile die Notiz nicht ohnehin abdeckt oder der Anker beim Abarbeiten
  wirklich hilft. Zeigt eine ganze Phase auf dieselbe Notiz, entfällt der
  Verweis in den Todos: die Wiederholung desselben Pfads pro Zeile war der
  grösste Einzelposten im Grössenbudget von `docs/TODO.md`.

Eine Notiz bleibt erhalten, solange Todo oder ADR sie als Detailquelle nutzt.
Wird ihr Inhalt zur aktuellen Wahrheit, wird er in die zuständige Quelle
überführt und hier nicht zusätzlich gepflegt.

Die vollständige Routing-Regel steht in [`docs/DOCS.md`](../DOCS.md).
