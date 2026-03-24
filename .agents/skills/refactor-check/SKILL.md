---
name: refactor-check
description: Analysiert geänderte oder aktuell bearbeitete Dateien und entscheidet pragmatisch, ob kein Refactor, ein kleiner Refactor oder ein struktureller Refactor sinnvoll ist. Use when der Nutzer nach Refactor-Bedarf, Refactor-Signalen, Datei-Zuschnitten, Verantwortlichkeiten, Extraktionen oder technischer Struktur in geänderten Dateien fragt.
---

Nutze diesen Workflow, wenn du beurteilen sollst, ob in geänderten oder aktuell bearbeiteten Dateien ein Refactor jetzt sinnvoll ist.

1. **Kontext laden (immer zuerst):**
   - Lies `docs/TODO.md`.
   - Lies `docs/REQUIREMENTS.md`.
   - Lies `docs/DECISIONS.md`.
   - Lies `docs/ARCHITECTURE.md`.
   - Prüfe erst danach Code oder Diffs, damit die Empfehlung zu den Projektregeln passt.

2. **Zielmenge festlegen:**
   - Nutze vom Nutzer genannte Dateien, falls vorhanden.
   - Falls keine Dateien genannt sind, inspiziere die geänderten Dateien.
   - Falls kein sinnvoller Diff-Kontext vorhanden ist, inspiziere die aktuell bearbeitete Datei oder die kleinste relevante Menge an Dateien.
   - Analysiere nur so viel Code, wie nötig ist, um eine belastbare Refactor-Empfehlung abzugeben.

3. **Refactor-Signale bewerten:**
   - Dateilänge grob über 250 bis 300 Zeilen.
   - Mehr als eine klar erkennbare Verantwortung in einem Modul.
   - Infrastruktur-Code gemischt mit Domain-Logik.
   - Wiederholte Error-Handling-Zweige.
   - Wiederholtes Redis-Key-Handling oder Pub/Sub-Handling.
   - Schwer testbare Funktionen wegen zu vieler Abhängigkeiten.
   - Prüfe immer, ob das Problem echte Reibung erzeugt oder nur theoretisch unsauber aussieht.

4. **Pragmatische Entscheidung treffen:**
   - `no refactor needed`: wenn die Datei trotz kleiner Schwächen noch lokal verständlich, testbar und passend zum aktuellen Scope ist.
   - `small refactor recommended now`: wenn eine kleine Extraktion die Lesbarkeit, Testbarkeit oder Änderbarkeit sofort verbessert, ohne Flows oder Architektur umzubauen.
   - `structural refactor should happen before more features`: wenn weitere Feature-Arbeit die falsche Struktur verfestigen würde oder neue Änderungen sonst unverhältnismäßig riskant werden.

5. **Kleinsten sicheren Plan ableiten:**
   - Empfiehl nie einen Rewrite, wenn eine Extraktion genügt.
   - Bevorzuge kleine, reversible Schritte.
   - Formuliere die kleinste sinnvolle Extraktion konkret, z. B. ein Helper, ein Plugin, ein Modul für Redis-Keys, ein Pub/Sub-Adapter oder eine entkoppelte Domain-Funktion.
   - Nenne bei strukturellem Refactor die erste sichere Etappe statt eines großen Zielbilds.

6. **Mit `docs/TODO.md` verbinden:**
   - Wenn der Refactor echte Folgearbeit erzeugt, verknüpfe die Empfehlung mit bestehenden offenen TODOs.
   - Falls kein passender TODO-Eintrag existiert, schlage einen kleinen, konkreten Follow-up-Task vor.
   - Erfinde keine großen Umbau-Epics ohne klaren Nutzen für den aktuellen Projektstand.

7. **Antwortformat einhalten:**
   - `Decision:` genau eine der drei erlaubten Entscheidungen.
   - `Why:` die 2 bis 4 wichtigsten Signale, bezogen auf konkrete Dateien oder Funktionen.
   - `Smallest useful next extraction:` die kleinste sichere Extraktion oder `none`.
   - `Risks of postponing the refactor:` konkrete Folgekosten oder `low`.

8. **Guardrails:**
   - Sei pragmatisch, nicht dogmatisch.
   - Empfiehl keine Architektur-Astronautik.
   - Bevorzuge kleine Extraktionen vor großen Rewrites.
   - Wenn du unsicher bist, entscheide gegen den Refactor und benenne die Beobachtung als Monitoring-Signal fuer spaetere Aenderungen.
   - Fuehre keinen Refactor direkt aus, solange der Nutzer nur eine Bewertung oder Empfehlung verlangt.
