# ADR-015: Custom Error Classes & Secure Error Handling

- **Datum:** 2026-03-04
- **Kontext:** Die API benötigt ein verlässliches Error-Handling. Zum einen müssen erwartbare fachliche Fehler (z.B. "Tickets ausverkauft" -> 409 Conflict) strukturiert an den Client gesendet werden. Zum anderen dürfen interne Systemfehler (500 Fehler, DB Exceptions) in der Produktion niemals echte Fehlermeldungen (Information Leakage) an den Client senden.
- **Entscheidung:** Einführung von abstrakten `AppError` Klassen (in `packages/types`), die von Standard-Errors ableiten und in einem zentralen Fastify Error Handler ausgewertet werden.
- **Begründung:** Der zentrale Error Handler fängt alle Exceptions ab. Wenn `error instanceof AppError`, ist es ein "Operational Error" und darf sicher (inkl. Status Code und Message) zum Client geschickt werden. Ist es ein unbekannter Fehler und `NODE_ENV === "production"`, verdeckt der Handler die echte Nachricht mit einem generischen "Internal Server Error" 500. Das schützt interne Infrastruktur-Details.
- **Alternativen:** Try/Catch in jeder einzelnen Route (zu viel Boilerplate, fehleranfällig).
