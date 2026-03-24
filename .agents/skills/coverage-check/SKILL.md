---
name: coverage-check
description: "Analysiert bestehende Tests, Codepfade und Coverage-Hinweise fuer einen aktuellen Bereich und priorisiert die wichtigsten fehlenden Tests. Nutze diese Skill fuer Test-Gap-Analyse, kritische Flow-Abdeckung, Happy Path, Failure Path, Retry/NACK, Idempotenz, Rollback und Payload-Validation."
argument-hint: 'Aktueller Bereich oder Feature, z. B. "apps/worker pubsub-listener" oder "buy flow"'
---

# Coverage Check

Nutze diesen Workflow, wenn du fuer einen aktuellen Bereich nicht einfach mehr Prozentpunkte willst, sondern die naechsten Tests mit dem hoechsten Sicherheitsgewinn identifizieren musst.

## Ziel

Die Skill priorisiert die kleinsten naechsten Testaufgaben, die die fachliche Korrektheit und Flow-Sicherheit am staerksten verbessern.

## Immer zuerst

1. Lese `docs/TODO.md`, `docs/REQUIREMENTS.md`, `docs/DECISIONS.md` und `docs/ARCHITECTURE.md` vollstaendig in den Kontext.
2. Uebernehme daraus die Architekturregeln fuer die Analyse, insbesondere:
   - API-Writes laufen nur asynchron ueber Pub/Sub.
   - Reads fuer Verfuegbarkeit laufen ueber Redis.
   - DTOs kommen aus `packages/types`; keine lokalen Typ-Duplikate.
   - Fastify-, Zod- und Drizzle-Konventionen muessen in Testvorschlaegen respektiert werden.

## Analyseablauf

1. **Bereich festlegen**
   - Bestimme den aktuellen Feature-Bereich aus der Nutzeranfrage, der offenen Datei, dem Diff oder den zuletzt geaenderten Dateien.
   - Schneide den Scope klein genug, damit am Ende 1 bis 3 atomare Testtasks vorgeschlagen werden koennen.

2. **Code und Tests gemeinsam lesen**
   - Lies die relevanten Source-Dateien und die dazugehoerigen Tests.
   - Suche gezielt nach Kontrollfluss, Seiteneffekten und externen Abhaengigkeiten: Redis, Pub/Sub, Datenbank, Fastify-Route-Schemas, Error-Handling, ACK/NACK-Entscheidungen.
   - Behandle bestehende Tests als Abdeckungskarte: Welche Pfade sind bereits abgesichert, welche nur implizit?

3. **Coverage-Artefakte nur als Sekundaersignal nutzen**
   - Wenn Coverage-Artefakte oder Reports vorhanden sind, nutze sie als Hinweis auf ungetestete Zeilen oder Zweige.
   - Priorisiere niemals blind nach Prozentwerten.
   - Bevorzuge immer verhaltenskritische Luecken gegenueber kosmetischen Luecken.

4. **Kritische Testluecken systematisch pruefen**
   - Happy Path: Erfolgreicher Standardfluss mit den wichtigsten Seiteneffekten und Rueckgaben.
   - Terminal Business Failure Path: Deterministischer Fachfehler mit korrektem Endzustand.
   - Retry- oder NACK-Pfad: Transiente Fehler, Redelivery, erneute Verarbeitung.
   - Idempotenzverhalten: Doppelte Nachricht, doppelter Request oder bereits verarbeitete `orderId`.
   - Rollback- oder Kompensationsverhalten: Reservation freigeben, Counter korrigieren, Status sauber zuruecksetzen.
   - Invalid Payload Validation: Zod-Schema-Verletzung, fehlende Felder, ungueltige Werte, falscher Contract.

5. **Wirkung statt Menge bewerten**
   - Bewerte jede Luecke nach fachlichem Risiko, Produktionsnaehe und Fehlerkosten.
   - Bevorzuge Tests, die Overselling, verlorene Reservierungen, doppelte Verarbeitung, stille ACK/NACK-Fehler oder Contract Drift sichtbar machen.
   - Wenn mehrere Luecken aehnlich wichtig sind, waehle die kleineren und besser isolierbaren Tasks zuerst.

6. **Atomare naechste Schritte formulieren**
   - Schlage nur 1 bis 3 naechste Testtasks vor.
   - Jede Task muss klein, direkt umsetzbar und klar abgrenzbar sein.
   - Formuliere Tasks so, dass sie auf existierende DTOs und Test-Helfer aufbauen, statt lokale Typen oder parallele Fixtures einzufuehren.

## Entscheidungsregeln

- Wenn Coverage niedrig ist, aber kritische Pfade bereits getestet sind, jage nicht Prozenten hinterher.
- Wenn ein Pfad geschaeftskritisch ist und aktuell nur indirekt getestet wird, behandle ihn als Luecke.
- Wenn ein Fehlerpfad zu Redis-, Pub/Sub- oder Datenbank-Inkonsistenz fuehren kann, priorisiere ihn vor reinem Response-Shape-Testing.
- Wenn ein Test nur interne Implementierungsdetails spiegelt, aber keinen fachlichen Schutz bringt, stufe ihn ab.
- Wenn DTO- oder Payload-Beispiele noetig sind, leite sie aus `packages/types` oder den zentralen Zod-Schemas ab.

## Ausgabeformat

Liefere die Analyse immer in genau diesen vier Teilen:

1. **Critical missing test scenarios**
   - Die wichtigsten fehlenden Szenarien, priorisiert nach Risiko.

2. **Why they matter**
   - Kurz erklaeren, welcher fachliche oder technische Schaden ohne diese Tests unentdeckt bleiben kann.

3. **Suggested next 1 to 3 atomic test tasks**
   - Kleine, direkt umsetzbare Tasks mit konkretem Ziel.

4. **Residual risk if they are skipped**
   - Welche Unsicherheit im System bleibt bestehen, wenn die vorgeschlagenen Tests nicht geschrieben werden.

## Qualitaetskriterien

- Fokus auf Korrektheit, Ablaufabdeckung und Systemverhalten, nicht auf Vanity Metrics.
- Beruecksichtige immer Architekturregeln und ADRs, nicht nur den lokalen Dateikontext.
- Keine Vorschlaege fuer lokale Typ-Duplikate oder isolierte Test-Contracts ausserhalb von `packages/types`.
- Bevorzuge Tests, die fachliche Invarianten und kritische Seiteneffekte absichern.
- Die vorgeschlagenen Tasks muessen klein genug fuer eine einzelne, reviewbare Implementierungsrunde sein.
