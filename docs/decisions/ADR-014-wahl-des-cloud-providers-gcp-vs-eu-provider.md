# ADR-014: Wahl des Cloud Providers (GCP vs. EU-Provider)

- **Datum:** 2026-02-27
- **Kontext:** Es wurde evaluiert, ob das Projekt anstatt auf einer US-Cloud (GCP) auf einem europäischen Provider (wie Scaleway, Exoscale, Hetzner, OVHcloud) gehostet werden sollte, primär aus Datenschutzgründen (DSGVO/GDPR) und um Vendor-Lock-in zu vermeiden.
- **Entscheidung:** Das Projekt verbleibt auf der Google Cloud Platform (GCP).
- **Begründung:** Da es sich um ein Demo-/Portfolio-Projekt handelt, existieren keine realen Nutzerdaten, weshalb DSGVO-Lokalität (Data Residency in der EU) hier keinen echten praktischen Vorteil bietet. Im Gegenzug bietet GCP entscheidende Vorteile für ein Portfolio-Projekt:
  - **Managed Services "Out-of-the-box":** GCP bietet mit Pub/Sub einen hochskalierbaren, komplett gemanagten Message Broker, der perfekt für unser asynchrones Write-Pattern ist. Bei EU-Providern müssten wir oft selbst Kafka/RabbitMQ managen oder auf Drittanbieter (wie Aiven bei Exoscale) ausweichen.
  - **Enterprise-Relevanz:** Erfahrung mit großen Hyperscalern (GCP, AWS, Azure) und deren proprietären Systemen (wie Cloud Spanner, Pub/Sub) wird von Recruitern und Enterprise-Unternehmen oft stärker gewichtet als Erfahrung mit kleineren EU-Clouds.
  - Das Setup über Terraform zeigt, dass wir Infrastructure-as-Code beherrschen, was die theoretische Portabilität beweist, ohne dass wir die Nachteile des "Self-Hostings" von Message Queues in Kauf nehmen müssen.
- **Alternativen (Evaluierte EU-Provider):**
  - _Scaleway (FR):_ Modern, gutes Managed Kubernetes und DBs, inkl. Messaging. Sehr nah an großen Clouds, aber weniger "Enterprise-Name-Drop"-Wert im Lebenslauf.
  - _Exoscale (CH):_ Exzellent für K8s und Datenschutz (Datencenter in Wien/München), gemanagte Services via Aiven. Leicht teurer und komplexer im Setup.
  - _Hetzner Cloud (DE):_ Unschlagbares Preis-Leistungs-Verhältnis für Compute, aber kein natives Managed Kubernetes oder Managed Message Queues. Erfordert sehr viel Eigenbau (z.B. K3s, RabbitMQ Operator), was vom Fokus (High-Frequency Backend Logik) ablenkt.
  - _OVHcloud (FR):_ Großer Player, aber stellenweise altbackene APIs und Terraform-Provider Eigenheiten.
