# Themen-Notizen

Arbeitsnotizen zu einem Thema: Recherche, Zwischenstaende, Messungen im Rohzustand,
offene Fragen, Varianten die noch nicht entschieden sind.

Dieses Verzeichnis existiert, damit `docs/TODO.md` ein Index bleiben kann. Vorher hatten
laengere Ueberlegungen keinen Ort und landeten deshalb im Todo selbst — bis 20 % der
Eintraege 79 % der Datei ausmachten (siehe ADR-029).

## Was hierher gehoert — und was nicht

| Inhalt                                                 | Ziel                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| Laufende Notizen, Recherche, Zwischenstand, Varianten  | **hier** — `docs/notes/<thema>.md`                           |
| Getroffene Entscheidung samt Abwaegung und Alternative | `docs/DECISIONS.md` (neuer ADR oder `### Update YYYY-MM-DD`) |
| Messergebnis, Lauf-Report, Benchmark                   | `docs/reports/<thema>/`                                      |
| Noch nicht gebauter Entwurf / Vorschlag                | `docs/suggested/`                                            |
| Welche Dateien und Tests eine Aenderung angefasst hat  | git-Commit-Body                                              |

Sobald aus einer Notiz eine Entscheidung wird, wandert sie als ADR nach `DECISIONS.md`.
Die Notiz darf danach stehen bleiben (sie erklaert den Weg dorthin) oder verschwinden —
Quelle der Wahrheit ist ab dann der ADR.

## Konventionen

- Ein Dokument pro Thema, Dateiname kebab-case: `k6-verteilter-runner.md`
- Erste Zeile `# <Thema>`, danach ein Satz, worum es geht
- Datierte Abschnitte (`## 2026-07-26 — <Titel>`) statt Umschreiben, damit der Verlauf lesbar bleibt
- Verlinkt wird aus dem Todo heraus, z. B. `→ [Notiz](notes/<thema>.md)`
