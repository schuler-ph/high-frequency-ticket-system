---
name: plan-next-task
description: Startet eine neue Arbeitssitzung — liest die aktive Phase aus docs/TODO.md und deren Stand, plant die nächste kleine Aufgabe und wartet auf Freigabe. Use when ein neuer Chat beginnt, der Nutzer fragt "was ist als Nächstes dran", "wo waren wir" oder eine Aufgabe aus dem Todo planen will.
---

Nutze diesen Workflow zu Beginn jeder Arbeitssitzung.

1. **Kontext progressiv aufbauen:**
   - Lies in `docs/TODO.md` die aktive Phase (die erste mit offenen Todos).
   - Lies den Abschnitt „Stand" der unter der Phase verlinkten Phasennotiz.
   - Lies die vom Kandidaten-Todo direkt verlinkten Details.
   - Nutze `docs/DOCS.md` als Router. Lade aus `docs/REQUIREMENTS.md` und
     `docs/ARCHITECTURE.md` nur die betroffenen Abschnitte.
   - Suche Entscheidungen zuerst im Index `docs/DECISIONS.md` und lies nur
     relevante Einzel-ADRs unter `docs/decisions/`.

2. **Aufgabe wählen und klein halten:**
   - Wähle das nächste offene Todo der aktiven Phase, sofern der Stand keinen
     Blocker oder anderen nächsten Schritt nennt.
   - Die Änderung muss klein und atomar sein, damit sie schnell reviewt werden
     kann. Ist das Todo zu groß, zerlege es in Teilaufgaben und trage diese
     als neue Zeilen am Ende der Phase ein.

3. **Plan vorlegen:**
   - Ziel der Sitzung, Akzeptanzkriterien, betroffene Dateien, Risiken.
   - Nenne, welche Doku sich mitändert (Requirement, Architektur, neuer ADR),
     falls die Aufgabe deren Wahrheit verändert.

4. **Auf das Go warten,** bevor Code geschrieben wird.

5. **Sitzung übergeben,** wenn die Arbeit endet oder der Kontext knapp wird:
   - Erledigte Todos abhaken: `- [x] **Titel (YYYY-MM-DD):** Ergebnis.`
   - Abschnitt „Stand" der Phasennotiz überschreiben: nächster Schritt, offene
     Fäden, Blocker.
   - Neue Entscheidungen als ADR anlegen und im Index verlinken.
   - `node scripts/check-docs.mjs` und die Projekt-Validierung ausführen.
