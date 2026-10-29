# Reports

Unveränderliche Messungen, Audits, Analysen und Benchmarks. Ein Report hält
fest, was zu einem Zeitpunkt beobachtet wurde, und wird danach nicht mehr
umgeschrieben. Korrekturen kommen als datierter Nachtrag oder als neuer Report.

## Ablage

- Ein Report pro Messung oder Untersuchung:
  `<thema>-<YYYY-MM-DD>.md`, bei Rohartefakten als Verzeichnis
  `<thema>-<YYYY-MM-DD>/` mit einer Hauptdatei.
- Jeder Report nennt Datum, Stand (Commit), Aufbau der Messung, Ergebnis und
  Schlussfolgerung.
- Schlussfolgerungen, die das System ändern, werden als Todo, Requirement oder
  ADR übernommen und verlinken auf den Report — nicht umgekehrt kopiert.

Die vollständige Routing-Regel steht in [`docs/DOCS.md`](../DOCS.md).
