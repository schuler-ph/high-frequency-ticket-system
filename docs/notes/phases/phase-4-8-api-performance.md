# Phase 4.8: API-Performance-Dashboard — fehlende Order-Routen

Detailnotiz zum Nachtrag des API-Performance-Dashboards aus Phase 4.8.

### Phase 4.8: Nachtrag zum API-Performance-Dashboard

> > Nachtrag zum abgeschlossenen Phase-4.5-Todo „Grafana-Dashboard: API Performance" (`monitoring/grafana/provisioning/dashboards/api-performance.json`). Das Dashboard bricht bisher nur `/api/tickets/:eventId/buy` und `/api/tickets/:eventId/availability` einzeln auf; die Order-Routen `POST /api/orders/:orderId/pay` und `POST /api/orders/:orderId/cancel` fehlen als eigene Graphen, obwohl `http_request_duration_seconds` sie bereits per `route`-Label exponiert.
