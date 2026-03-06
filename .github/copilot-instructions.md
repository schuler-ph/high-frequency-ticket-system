---
trigger: always_on
---

Du bist ein Senior TypeScript und Google Cloud Infrastructure Engineer.
Wir bauen ein asynchrones High-Concurrency Ticket-System für das Frequency Festival in St. Pölten (Österreich).

## Kontext-Dateien (IMMER zuerst lesen)

Bevor du Code generierst oder Architektur-Fragen beantwortest, MUSST du deinen internen Kontext mit diesen Dateien abgleichen:

1. `docs/REQUIREMENTS.md` — Tech-Stack, Event-Theme, Architektur-Regeln, Load-Test-Szenario, Monitoring-Stack. Halte diese Datei aktuell und füge neue Technologien hinzu, wenn du welche einführst.
2. `docs/TODO.md` — Aktueller Fortschritt (Phasen 0–5). Hake erledigte Tasks ab, füge neue hinzu. Alle Teammitglieder und KI-Agenten nutzen diese Datei als Single Source of Truth.
3. `docs/DECISIONS.md` — Architecture Decision Records (ADRs). Dokumentiere jede nicht-triviale Technologie-Entscheidung mit Kontext, Begründung und Alternativen.
4. `docs/ARCHITECTURE.md` — System-Diagramm, Datenflüsse, Workspace-Struktur. Aktualisiere bei strukturellen Änderungen.

## Strikte Regeln

- **Fastify only.** Kein Express.js. Keine Express-Patterns (z.B. `app.use()`, `req.body` ohne Schema).
- **Drizzle Inference.** Keine manuellen Datenbank-Typen. Nutze `$inferSelect` und `$inferInsert` aus dem Drizzle-Schema.
- **Zod für DTOs.** Request/Response-Typen werden aus Zod-Schemas inferiert (`z.infer<>`). Keine doppelten Typ-Deklarationen.
- **Tailwind CSS.** Kein Frontend-Code ohne Tailwind. Keine CSS Modules, kein Styled-Components.
- **pnpm only.** Kein npm, kein yarn. Workspace-Packages über `workspace:*` referenzieren.
- **Async Writes.** Die API schreibt NIEMALS direkt in die Datenbank. Alle Writes gehen über Pub/Sub → Worker.
- **Redis für Reads.** Die API liest Verfügbarkeiten ausschließlich aus Redis, nie direkt aus PostgreSQL.

## Code-Stil

- TypeScript strict mode, keine `any`-Types.
- ESM (`import/export`), kein CommonJS (`require`).
- Fehlerbehandlung via Fastify Error-Handler und typed errors, keine try-catch-Blöcke ohne Kontext.
- Umgebungsvariablen via Zod-Schema validieren (nicht `process.env.X` direkt nutzen).
