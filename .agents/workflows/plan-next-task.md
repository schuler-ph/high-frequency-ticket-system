---
description: Analysiert `todo.md`, plant die nächste kleine Aufgabe und aktualisiert die Dokumentation
---

Nutze diesen Workflow jedes Mal, wenn du eine neue Entwicklungs-Session mit dem KI-Agenten startest.

1. **Kontext aufbauen (Immer zuerst ausführen):**
   - Lese `docs/TODO.md`, um offene und in Arbeit befindliche Tasks zu analysieren.
   - Lese `docs/REQUIREMENTS.md`, `docs/DECISIONS.md` und `docs/ARCHITECTURE.md`, um Architekturvorgaben, aktuelle Designentscheidungen und Regeln (wie Fastify, Drizzle, pnpm) in deinen Kontext zu laden.

2. **Aufgabe identifizieren & klein halten:**
   - Wähle das nächste offene Feature oder den nächsten offenen Bugfix aus `docs/TODO.md`.
   - WICHTIG: Die auszuführende Änderung muss **klein und atomar** sein, damit sie schnell und sicher reviewt werden kann.
   - Sollte das nächste TODO zu groß sein, brich es in mehrere kleine, schnell machbare Teilaufgaben herunter.

3. **Dokumentation proaktiv anpassen:**
   - Sobald absehbar ist, dass für diese Aufgabe neue Design-Patterns, Bibliotheken oder Architekturänderungen nötig werden:
     - Dokumentiere neue Architektur-Entscheidungen sofort in `docs/DECISIONS.md` (als Architecture Decision Record / ADR).
     - Aktualisiere Diagramme und Strukturinfos in `docs/ARCHITECTURE.md`.
     - Ergänze Tech-Stack oder globale Limitierungen in `docs/REQUIREMENTS.md`.

4. **Plan erstellen & bestätigen lassen:**
   - Präsentiere einen konkreten Schritt-für-Schritt-Implementierungsplan (`implementation_plan.md` oder als kompakte Chat-Antwort).
   - Vergewissere dich beim Entwickler, ob das Vorgehen und die identifizierte kleine Aufgabe für diese Session passen.

5. **Warte auf das "Go":**
   - Nach Erstellung des Plans, pausiere und warte auf die Freigabe, bevor du mit dem eigentlichen Schreiben des Codes beginnst.
