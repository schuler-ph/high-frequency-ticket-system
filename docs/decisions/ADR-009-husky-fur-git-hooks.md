# ADR-009: Husky für Git Hooks

- **Datum:** 2026-02-24
- **Kontext:** Code-Qualität soll lokal vor Commit/Push sichergestellt werden, ohne dass Entwickler manuell Befehle ausführen müssen. CI soll nicht der erste Ort sein, an dem Fehler auffallen.
- **Entscheidung:** Husky mit zwei Hooks: `pre-commit` (format), `pre-push` (lint + typecheck). Build läuft nur in der CI-Pipeline.
- **Begründung:** Format beim Commit hält Diffs sauber. Lint + Typecheck beim Push verhindert kaputte Pushes. Build nur in CI, um lokale Wartezeiten kurz zu halten. Turbo-Cache macht wiederholte Runs fast instant.
- **Alternativen:** lefthook (weniger verbreitet), simple-git-hooks (weniger Features), nur CI (Feedback-Loop zu lang).
