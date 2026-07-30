# ADR-006: Prometheus + Grafana für Monitoring

- **Datum:** 2026-02-24
- **Kontext:** Lasttest-Ergebnisse müssen visuell dokumentiert werden für das GitHub README. Das System muss unter Last beobachtbar sein. Lokales Development braucht ein kostenloses, leichtgewichtiges Setup.
- **Entscheidung:** Prometheus für Metrics Collection (via `prom-client` in Fastify), Grafana für Dashboards. Lokal via Docker Compose. k6 exportiert direkt an Prometheus → Live-Visualisierung in Grafana.
- **Begründung:** Offener Standard, kostenlos, riesiges Ecosystem. k6 hat native Prometheus-Integration. Grafana-Dashboards können als JSON exportiert und im Repo versioniert werden. OpenTelemetry wurde bewusst weggelassen – Prometheus + Grafana decken den Scope (Metriken + Dashboards) vollständig ab. OTel wäre nur für Distributed Tracing über viele Services relevant, was hier Overkill ist.
- **Alternativen:** Cloud Monitoring (kostet Geld, nur in GCP), Datadog (proprietär, teuer), OpenTelemetry (zu komplex für den Scope).
