# ADR-029: Doku-Routing — TODO.md ist ein Index, kein Protokoll

- **Status:** Fertig; Archivklausel durch ADR-032 präzisiert

- **Datum:** 2026-07-26
- **Kontext:** `docs/TODO.md` ist als Single Source of Truth fuer den Fortschritt deklariert und laut `CLAUDE.md` von jedem Agenten **zuerst** zu lesen. Die Datei war auf 70 KB gewachsen, bei nur 324 Zeilen — Todos hatten sich seit Projektstart 4,2× vermehrt, die Dateigroesse aber **20×** (3,5 KB → 70 KB, Knick zwischen 2026-07-14 und 07-19). Ursache war ein einzelnes Muster, keine allgemeine Geschwaetzigkeit: der Umsetzungsbericht nach dem Gedankenstrich (`- [x] <Aufgabe> — Umgesetzt: <mehrere hundert Woerter>`). 39 Zeilen mit diesem Nachtrag lagen bei ⌀ **1.009** Zeichen (laengste 2.506), die uebrigen 146 bei ⌀ **142** — rund 20 % der Eintraege hielten ~79 % der Bytes. Praktische Folge: jeder Agent zahlte 70 KB Kontext, nur um „was ist als Naechstes dran?" zu beantworten, und ein Mensch konnte die Datei nicht mehr ueberfliegen. Der Roadmap-Kopf raeumte das selbst ein („nicht mehr strikt von oben nach unten abzuarbeiten").
- **Entscheidung:** TODO.md wird ein Index. Ein Todo ist eine Zeile mit hartem Budget von **300 Zeichen**; Details werden nach Inhaltstyp geroutet:
  - Begruendung, Abwaegung, verworfene Alternative → `docs/DECISIONS.md` (neuer ADR oder `### Update YYYY-MM-DD` unter dem bestehenden)
  - Messwerte, Lauf-Ergebnisse, Benchmarks → `docs/reports/<thema>/`
  - Welche Dateien und Tests angefasst wurden → git-Commit-Body
  - Laufende Notizen, Recherche, Zwischenstaende → **neu:** `docs/notes/<thema>.md`
  - Wortgleiche Original-Todos aus der Kuerzung → **neu:** `docs/TODO-ARCHIVE.md`

  Erzwungen wird das von `scripts/debug/check-docs.mjs` (`pnpm run debug:docs`, Teil von `debug:all`): Zeichenbudget je Todo und je Prosa-Absatz, Aufloesbarkeit aller Backtick-Repo-Pfade und Markdown-Links in `docs/`, Existenz der Anker-Ueberschriften, plus 40-KB-Backstop fuer TODO.md.

  Die append-forward-Regel bleibt, bekommt aber eine Klausel: Kuerzen eines `[x]`-Todos ist erlaubt, **wenn** der Originaltext wortgleich nach `docs/TODO-ARCHIVE.md` wandert und das Todo dorthin verlinkt. Es geht nie Text verloren, nur der Ort aendert sich.

- **Begruendung:** Drei der vier Inhaltstypen hatten laengst ein Zuhause (`DECISIONS.md` inklusive Nachtrags-Konvention, `docs/reports/`, git) — es fehlte nur die Regel, sie zu benutzen. Wirklich neu ist allein `docs/notes/`, und genau dessen Fehlen erklaert das Wachstum: laengere Ueberlegungen ohne Entscheidungscharakter hatten keinen Ort und landeten deshalb im Todo. Eine reine Textregel haette nicht getragen — die Explosion entstand ohne dass jemand eine Regel brach. Deshalb der maschinelle Check im bestehenden `debug:*`-Muster statt einer Konvention, an die sich alle erinnern muessen.
- **Alternativen (verworfen):**
  - **Nur ab jetzt, Historie unangetastet:** haette die 70 KB und die Unlesbarkeit eingefroren; das Problem waere nur nicht groesser geworden.
  - **Archiv-Split ohne Kuerzen** (abgeschlossene Phasen komplett nach `TODO-ARCHIVE.md`, TODO.md behaelt nur offene Arbeit): haette die append-forward-Regel buchstabengetreu gewahrt, aber den Fortschritt der fertigen Phasen aus der Uebersicht genommen — genau das Signal, das die Datei liefern soll.
  - **Alle Nachtraege nach `docs/notes/`:** einfacher zu merken, haette aber Entscheidungen ausserhalb von `DECISIONS.md` abgelegt und damit dessen Anspruch auf Vollstaendigkeit gebrochen.
  - **Gar kein Nachtrag** („steht im git log"): am schlanksten, haette aber die Abwaegungen („bewusst anders geloest als vorgeschlagen") als lesbare Doku verloren.
  - **husky pre-commit statt `debug:all`:** haette jeden Commit verlangsamt; `pre-commit` macht bewusst nur `pnpm run format`, und ueber `debug:all` laeuft der Check ohnehin in `verify:quick`, `verify:all` und CI.
- **Trade-off / bewusst offen:** Der Check kennt zwei Abschwaechungen. Historische Datei-Erwaehnungen in ADRs („der bisherige `load-tests/spike.js`") stehen auf einer expliziten Allowlist im Skript, weil ein ADR-Kontext legitim ueber entfernte Dateien spricht. Und Links auf **gitignorierte** Ziele werden nur gewarnt statt geblockt — `docs/reports/baseline-b-2026-07-26/LOAD-TEST-REPORT-2026-07-26.md` verlinkt seine Rohartefakte, die das breite `artifacts/`-Pattern in `.gitignore` mitfaengt. Ob diese Evidenz ins Repo gehoert, ist eine eigene Entscheidung und bleibt offen.
- **Umsetzung:**
  - `scripts/debug/check-docs.mjs` (neu), `package.json` (`debug:docs`, in `debug:all`)
  - `docs/notes/README.md` (neu, Abgrenzung der Ablageorte)
  - `docs/TODO-ARCHIVE.md` (neu, wortgleiche Originale der gekuerzten Eintraege)
  - `docs/TODO.md` (49 Eintraege und 6 Absaetze gekuerzt, 4 tote Pfade korrigiert)
  - Doku-Lockstep: `.github/copilot-instructions.md` (= `CLAUDE.md`) und `.agents/rules/rules.md`

### Update 2026-07-30: Thematische Notizen statt Sammelarchiv

Die Grundentscheidung bleibt: `docs/TODO.md` ist ein kompakter Arbeitsindex.
Die einzelne Datei TODO-ARCHIVE.md hat jedoch wieder einen 68-KB-Monolithen
erzeugt und wird nicht fortgeführt. Bestehende Detailtexte liegen jetzt
verlustfrei und direkt verlinkt unter `docs/notes/phases/` oder
`docs/notes/backlogs/`; große Nachläufe sind zusätzlich nach Stage oder
Priorität geteilt. Die historische Archivklausel dieses ADR wird damit durch
ADR-032 ersetzt.
