---
trigger: always_on
---

Du bist ein Senior TypeScript und Google Cloud Infrastructure Engineer.
Wir bauen ein asynchrones High-Concurrency Ticket-System für das Frequency Festival in St. Pölten (Österreich).

## Kontext-Dateien (IMMER zuerst lesen)

Bevor du Code generierst oder Architektur-Fragen beantwortest, MUSST du deinen internen Kontext mit diesen Dateien abgleichen:

1. `docs/REQUIREMENTS.md` — Tech-Stack, Event-Theme, Architektur-Regeln, Load-Test-Szenario, Monitoring-Stack. Halte diese Datei aktuell und füge neue Technologien hinzu, wenn du welche einführst.
2. `docs/TODO.md` — Aktueller Fortschritt (Phasen 0–5). Hake erledigte Tasks ab und füge neue Arbeit **nur vorwärts** hinzu (siehe Strikte Regeln → "TODO.md ist append-forward"). Alle Teammitglieder und KI-Agenten nutzen diese Datei als Single Source of Truth.
3. `docs/DECISIONS.md` — Architecture Decision Records (ADRs). Dokumentiere jede nicht-triviale Technologie-Entscheidung mit Kontext, Begründung und Alternativen.
4. `docs/ARCHITECTURE.md` — System-Diagramm, Datenflüsse, Workspace-Struktur. Aktualisiere bei strukturellen Änderungen.

Ablageorte für alles, was zu lang für ein Todo ist: `docs/notes/` (laufende Themen-Notizen), `docs/reports/` (Messungen), `docs/suggested/` (Entwürfe), `docs/TODO-ARCHIVE.md` (wortgleiche Original-Todos). Siehe Strikte Regeln → "TODO.md ist ein Index, kein Protokoll".

## Strikte Regeln

- **Fastify only.** Kein Express.js. Keine Express-Patterns (z.B. `app.use()`, `req.body` ohne Schema).
- **Drizzle Inference.** Keine manuellen Datenbank-Typen. Nutze `$inferSelect` und `$inferInsert` aus dem Drizzle-Schema.
- **Zod für DTOs.** Request/Response-Typen werden aus Zod-Schemas inferiert (`z.infer<>`). Keine doppelten Typ-Deklarationen.
- **Tailwind CSS.** Kein Frontend-Code ohne Tailwind. Keine CSS Modules, kein Styled-Components.
- **pnpm only.** Kein npm, kein yarn. Workspace-Packages über `workspace:*` referenzieren.
- **Async Writes.** Die API schreibt NIEMALS direkt in die Datenbank. Alle Writes gehen über Pub/Sub → Worker.
- **Redis für Reads.** Die API liest Verfügbarkeiten ausschließlich aus Redis, nie direkt aus PostgreSQL.
- **TODO.md ist append-forward (unveränderliche Historie).** Abgehakte (`[x]`) Todos sind eingefroren: ihr Text wird nicht nachträglich umgeschrieben und sie werden nicht wieder geöffnet. Eine Phase, deren Todos alle abgehakt sind, gilt als abgeschlossen und darf **keine** neuen offenen Todos mehr erhalten. Nachträglich entdeckte Arbeit kommt ausschließlich in eine neue Phase oder einen Backlog-Abschnitt am Ende der Datei. (Korrektur eines echten Fehlers in einem `[x]`-Todo ist erlaubt, aber als neues Todo mit Verweis auf das alte.) **Kürzen** eines `[x]`-Todos ist erlaubt, wenn der Originaltext wortgleich nach `docs/TODO-ARCHIVE.md` wandert und das Todo dorthin verlinkt.
- **TODO.md ist ein Index, kein Protokoll.** Ein Todo ist **eine Zeile**: `- [ ] **Titel:** ein Satz, was zu tun ist. → Link`. Harte Grenze **300 Zeichen** pro Todo, Abschnitts-Vorspann ebenfalls max. 300 Zeichen; erzwungen von `pnpm run debug:docs`. Schreibe **keinen** `— Umgesetzt: …`-Bericht in die Zeile — ein abgehaktes Todo nennt Problem und Ergebnis in einem Satz, alles Weitere hängt am Link. Längeres wird nach Inhaltstyp geroutet:

  | Inhalt                                                 | Ziel                                                                               |
  | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
  | Begründung, Abwägung, verworfene Alternative           | `docs/DECISIONS.md` — neuer ADR oder `### Update YYYY-MM-DD` unter dem bestehenden |
  | Messwerte, Lauf-Ergebnisse, Benchmarks                 | `docs/reports/<thema>/`                                                            |
  | Welche Dateien und Tests die Änderung angefasst hat    | git-Commit-Body                                                                    |
  | Laufende Notizen, Recherche, Zwischenstände, Varianten | `docs/notes/<thema>.md` (siehe `docs/notes/README.md`)                             |

## Code-Stil

- TypeScript strict mode, keine `any`-Types.
- ESM (`import/export`), kein CommonJS (`require`).
- Fehlerbehandlung via Fastify Error-Handler und typed errors, keine try-catch-Blöcke ohne Kontext.
- Umgebungsvariablen via Zod-Schema validieren (nicht `process.env.X` direkt nutzen).
