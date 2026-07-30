# ADR-016: GCP-Ready Structured Logging mit Pino

- **Datum:** 2026-03-04
- **Kontext:** Für Observability und Fehlersuche müssen Logs strukturiert in der Cloud (GCP Stackdriver / Cloud Logging) ankommen. Fastify nutzt standardmäßig Pino.
- **Entscheidung:** Pino wird so konfiguriert, dass das Standardfeld `level` (ein Integer bei Pino) zu einem GCP-kompatiblen Feld `severity` (z.B. "INFO", "ERROR") umgeschrieben wird.
- **Begründung:** Cloud Logging parst Pino's rohes JSON automatisch. Wenn jedoch das `severity`-Feld fehlt, werden alle Logs in der GCP UI standardmäßig als wertloses "DEFAULT" oder "INFO" klassifiziert, auch wenn es fatale Fehler sind. Die Mapping-Config sichert 100%ige Kompatibilität zur GCP-Log-Analyse ohne Performance-Verlust. Alle Logs enthalten zudem automatisch die Fastify `reqId`, um Requests über API und Worker tracebar zu machen.
- **Alternativen:** Winston oder Morgan statt Pino (unnötiger Overhead, Pino ist in Fastify integriert und der schnellste Node Logger), externer Log-Agent (zu viel DevOps Overhead für dieses Setup).
