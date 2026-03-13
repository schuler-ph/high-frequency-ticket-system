# Architecture Decision Records (ADR)

Jede Architekturentscheidung wird hier als ADR dokumentiert. Das erlaubt es, den Kontext und die Begründung jeder Entscheidung nachzuvollziehen – sowohl für Teammitglieder als auch für KI-Agenten, die am Projekt arbeiten.

## ADR Status & TODO-Mapping

Dieses Kapitel verknüpft jede ADR mit dem aktuellen Umsetzungsstatus und der Stelle in `docs/TODO.md`, in der die Umsetzung erledigt wurde oder geplant ist.

| ADR | Status | TODO-Abbildung |
| --- | --- | --- |
| ADR-001 Monorepo mit Turborepo | Fertig | Phase 1 (Foundation & Tooling) erledigt |
| ADR-002 Fastify statt Express | Fertig | Phase 3 (Core Logic) API + Worker Setup erledigt |
| ADR-003 Drizzle ORM statt Prisma | Fertig | Phase 2 (Data Layer) Drizzle Setup + Migration erledigt |
| ADR-004 Asynchrone Writes über Pub/Sub | Teilweise fertig | Phase 3 Buy-Flow erledigt; Härtung in Phase 3.5 (Reservation/ACK-NACK-Klarheit) geplant |
| ADR-005 Redis als Read-Cache | Teilweise fertig | Phase 3 Availability-Read erledigt; event-spezifische Keys + Reconcile in Phase 3.5 geplant |
| ADR-006 Prometheus + Grafana | Geplant | Phase 4.5 (Monitoring & Observability) |
| ADR-007 GitHub Actions für CI/CD | Fertig | Phase 1 (`.github/workflows/ci.yml`) erledigt |
| ADR-008 Zod für Validation & DTOs | Fertig | Phase 2 DTOs + Phase 3 Route-Schemas erledigt |
| ADR-009 Husky für Git Hooks | Fertig | Bereits umgesetzt (außerhalb der Phasenliste, als Standard-Tooling aktiv) |
| ADR-010 Terraform für IaC | Geplant | Phase 5 (Cloud Deployment) |
| ADR-011 Capacity Model vs. Pre-generated Tickets | Teilweise fertig | Phase 2/3 Grundmodell erledigt; End-to-End-Korrektheit in Phase 3.5 geplant |
| ADR-012 Guest Checkout | Fertig | Phase 3 Buy-Request ohne Auth umgesetzt |
| ADR-013 Payment Flow Mocking | Geplant | Phase 3 Worker-Latenz als Aufgabe vorgesehen, final aktivieren in Phase 3.5 |
| ADR-014 Cloud Provider GCP | Geplant | Phase 5 (GCP Terraform + Deployment) |
| ADR-015 Custom Error Classes & Secure Error Handling | Fertig | Phase 3 Error Handler und typed errors umgesetzt |
| ADR-016 GCP-ready Structured Logging mit Pino | Fertig | API/Worker Logger-Konfiguration umgesetzt |
| ADR-017 Order-Status via Polling | Geplant | Phase 3.5 Orders↔Tickets Verknüpfung + später Phase 4 Frontend-Polling |
| ADR-018 Ticket-Kauf via SQL-Function im Worker | Fertig | Phase 3 Worker nutzt `buy_ticket(...)` |

### Status-Definitionen

- **Fertig:** Architekturentscheidung ist im Codepfad aktiv und im Alltag genutzt.
- **Teilweise fertig:** Kern ist umgesetzt, aber Resilience/Konsistenz/Skalierungsdetails fehlen noch.
- **Geplant:** Entscheidung ist dokumentiert, Umsetzung liegt in einer offenen TODO-Phase.

---

## ADR-001: Monorepo mit Turborepo

- **Datum:** 2026-02-24
- **Kontext:** Einzelnes Showcase-Projekt mit Frontend, API, Worker und shared Packages. Recruiter und Reviewer sollen alles in einem Repository sehen können.
- **Entscheidung:** Turborepo mit pnpm Workspaces.
- **Begründung:** Einfacher als Nx für diesen Scope. Exzellentes Build-Caching. Nativer Support für pnpm. Klare Workspace-Struktur (`apps/*`, `packages/*`).
- **Alternativen:** Nx (zu komplex für Scope), separate Repositories (fragmentiert Portfolio).

---

## ADR-002: Fastify statt Express

- **Datum:** 2026-02-24
- **Kontext:** High-Concurrency API benötigt maximale Performance bei I/O-bound Workloads. Das System muss unter extremer Last (50.000+ gleichzeitige Nutzer) stabil bleiben.
- **Entscheidung:** Fastify als HTTP-Framework für API Gateway und Worker.
- **Begründung:** ~2x schneller als Express in Benchmarks. Schema-basierte Serialisierung reduziert Overhead. Native TypeScript-Unterstützung. Plugin-Architektur passt zu Microservice-Pattern.
- **Alternativen:** Express (langsamer, legacy patterns), Hono (weniger Ecosystem-Support für Node.js).

---

## ADR-003: Drizzle ORM statt Prisma

- **Datum:** 2026-02-24
- **Kontext:** ORM muss typsicher sein, nah an SQL bleiben und minimalen Runtime-Overhead erzeugen. Späterer Wechsel zu Cloud Spanner muss möglich sein.
- **Entscheidung:** Drizzle ORM (Code-First).
- **Begründung:** Typen werden direkt aus dem Schema inferiert (`$inferSelect`, `$inferInsert`). Kein Code-Generator nötig. SQL-nah = einfacherer Wechsel zu Cloud Spanner. Leichtgewichtiger als Prisma (kein Rust-basierter Engine-Binary).
- **Alternativen:** Prisma (schwerer, generierter Client), Kysely (kein Migration-Tooling).

---

## ADR-004: Asynchrone Writes über Pub/Sub

- **Datum:** 2026-02-24
- **Kontext:** Bei Lastspitzen (Ticket-Sale-Start) würden direkte DB-Schreibzugriffe die PostgreSQL-Instanz überlasten. Die API muss sofort antworten können, unabhängig von der DB-Kapazität.
- **Entscheidung:** API published Kauf-Intents in Google Cloud Pub/Sub, Worker konsumiert und schreibt in DB.
- **Begründung:** Entkopplung von Spike-Traffic und DB-Write-Kapazität. API kann sofort HTTP 202 (Accepted) antworten. Pub/Sub garantiert At-Least-Once Delivery. Worker kann unabhängig skaliert werden.
- **Alternativen:** Direktes DB-Write mit Connection Pooling (skaliert nicht ausreichend), Redis Streams (weniger Feature-reich als Pub/Sub).

---

## ADR-005: Redis als Read-Cache

- **Datum:** 2026-02-24
- **Kontext:** Die API muss Ticket-Verfügbarkeiten in Sub-Millisekunden-Bereich liefern. Direkte DB-Reads unter Last sind zu langsam und überlasten PostgreSQL.
- **Entscheidung:** Cloud Memorystore (Redis) als exklusive Read-Quelle für die API. Worker aktualisiert den Cache nach erfolgreichen DB-Writes.
- **Begründung:** Redis liefert konsistente Reads im Mikrosekunden-Bereich. Atomic Decrement (`DECR`) verhindert Overselling. Eventual Consistency ist akzeptabel für Verfügbarkeitsanzeige.
- **Alternativen:** DB-Read-Replicas (teurer, höhere Latenz), Application-Level Cache (nicht cluster-fähig).

---

## ADR-006: Prometheus + Grafana für Monitoring

- **Datum:** 2026-02-24
- **Kontext:** Lasttest-Ergebnisse müssen visuell dokumentiert werden für das GitHub README. Das System muss unter Last beobachtbar sein. Lokales Development braucht ein kostenloses, leichtgewichtiges Setup.
- **Entscheidung:** Prometheus für Metrics Collection (via `prom-client` in Fastify), Grafana für Dashboards. Lokal via Docker Compose. k6 exportiert direkt an Prometheus → Live-Visualisierung in Grafana.
- **Begründung:** Offener Standard, kostenlos, riesiges Ecosystem. k6 hat native Prometheus-Integration. Grafana-Dashboards können als JSON exportiert und im Repo versioniert werden. OpenTelemetry wurde bewusst weggelassen – Prometheus + Grafana decken den Scope (Metriken + Dashboards) vollständig ab. OTel wäre nur für Distributed Tracing über viele Services relevant, was hier Overkill ist.
- **Alternativen:** Cloud Monitoring (kostet Geld, nur in GCP), Datadog (proprietär, teuer), OpenTelemetry (zu komplex für den Scope).

---

## ADR-007: GitHub Actions für CI/CD

- **Datum:** 2026-02-24
- **Kontext:** Automatisierte Quality Gates (lint, typecheck, build) sind notwendig, um Code-Qualität im Monorepo sicherzustellen.
- **Entscheidung:** GitHub Actions mit Turborepo-Cache für lint, typecheck und build.
- **Begründung:** Native GitHub-Integration. Kostenlose Minuten für Open-Source-Repos. Turborepo-Cache beschleunigt CI-Runs erheblich.
- **Alternativen:** GitLab CI (anderer Hoster), Cloud Build (GCP-only Lock-in).

---

## ADR-008: Zod für Schema Validation & DTOs

- **Datum:** 2026-02-24
- **Kontext:** Request-Validation muss typsicher sein und darf keine doppelten Typ-Deklarationen erzeugen. Fastify nutzt JSON Schema für Serialisierung.
- **Entscheidung:** Zod-Schemas als Single Source of Truth für Request/Response-Typen. TypeScript-Typen werden via `z.infer<>` abgeleitet.
- **Begründung:** Zod ist der De-facto-Standard für Runtime-Validation in TypeScript. Integration mit Fastify via `zod-to-json-schema`. Keine manuellen Typ-Duplikate.
- **Alternativen:** Ajv + manuelle Typen (fehleranfällig), TypeBox (weniger verbreitet).

---

## ADR-009: Husky für Git Hooks

- **Datum:** 2026-02-24
- **Kontext:** Code-Qualität soll lokal vor Commit/Push sichergestellt werden, ohne dass Entwickler manuell Befehle ausführen müssen. CI soll nicht der erste Ort sein, an dem Fehler auffallen.
- **Entscheidung:** Husky mit zwei Hooks: `pre-commit` (format), `pre-push` (lint + typecheck). Build läuft nur in der CI-Pipeline.
- **Begründung:** Format beim Commit hält Diffs sauber. Lint + Typecheck beim Push verhindert kaputte Pushes. Build nur in CI, um lokale Wartezeiten kurz zu halten. Turbo-Cache macht wiederholte Runs fast instant.
- **Alternativen:** lefthook (weniger verbreitet), simple-git-hooks (weniger Features), nur CI (Feedback-Loop zu lang).

---

## ADR-010: Terraform für Infrastructure as Code (IaC)

- **Datum:** 2026-02-25
- **Kontext:** Das Projekt soll realistisch in der Google Cloud (GKE, Cloud SQL, Memorystore, Pub/Sub) laufen. Für das Portfolio und die Reproduzierbarkeit muss das Infrastruktur-Setup code-basiert, versioniert und wiederholbar sein.
- **Entscheidung:** Terraform für das gesamte Cloud-Ressourcen-Management. Kubernetes-Manifeste werden über klassische YAML-Dateien (oder Helm) via Kubeconfig angewendet, nachdem Terraform den GKE Cluster provisioniert hat.
- **Begründung:** Terraform ist der unangefochtene Industrie-Standard für Cloud-agnostische, aber Cloud-native Infrastruktur. Es ermöglicht ein sauberes Setup von VPCs, IAM und den gemanagten Services (Cloud SQL, Redis, Pub/Sub).
- **Alternativen:**
  - _Google Cloud Deployment Manager:_ Veraltet, wird kaum noch genutzt.
  - _Pulumi:_ Moderner (TypeScript), aber Terraform ist aktuell noch der de-facto Standard, den Recruiter/Seniors bevorzugen.
  - _ClickOps (GCP Console):_ Nicht reproduzierbar, keine Versionierung (absolutes No-Go für ein Showcase-Projekt).

---

## ADR-011: Event Capacity Model vs. Pre-generated Tickets

- **Datum:** 2026-02-25
- **Kontext:** 1.000.000 Tickets sollen verkauft werden, personalisiert mit Name, Geburtsdatum, Adresse etc. Die Pre-Generation von 1 Million leeren Rows bläht die Datenbank extrem auf und Updates darauf sind ineffizient.
- **Entscheidung:** Wir nutzen ein Capacity-Modell kombiniert mit Ticket-Generierung on-the-fly (`INSERT` statt `UPDATE`).
- **Begründung:** Eine zentrale Tabelle `events` speichert `total_capacity` und `sold_capacity`. Der Redis-Cache hält initial die volle Kapazität als Integer und zählt pro Kauf atomar herunter (`DECR`). Erst wenn der Kauf via Pub/Sub im Worker bearbeitet wird, erfolgt ein `INSERT` eines neuen, fertig personalisierten Tickets (inkl. generierter UUID als Ticket-Code/QR-Code-Ersatz) in die Tabelle `tickets` und ein atomares Erhöhen der `sold_capacity`. So enthält die Datenbank nur so viele Ticket-Rows, wie tatsächlich verkauft wurden.
- **Alternativen:** 1 Mio. leere Rows vorab generieren (ineffizient für RDBMS, riesiger Speicher-Overhead und Table Scans), NoSQL mit Object-Appends (passt nicht zu unseren relationalen ACID-Anforderungen).

---

## ADR-012: Guest Checkout (Keine Authentifizierung)

- **Datum:** 2026-02-25
- **Kontext:** Authentifizierung (OAuth, NextAuth) lenkt vom Kern-Szenario (High-Concurrency, Async Writes) ab und erhöht die Komplexität des Beispielprojekts.
- **Entscheidung:** Keine E-Mail/Passwort- oder Social-Login Authentifizierung. Es wird ein Guest-Checkout implementiert.
- **Begründung:** Die zu personalisierenden Käuferdaten (Vorname, Adresse, etc.) werden direkt im POST-Request beim Ticket-Kauf mitgeliefert. Das Frontend generiert eine lokale Request/Session-UUID um per Polling abfragen zu können, ob das asynchrone Ticket erfolgreich generiert wurde. Der Scope bleibt somit streng fokussiert auf System-Performance.
- **Alternativen:** Vollständige Auth via Supabase/NextAuth (zu viel Feature-Creep).

---

## ADR-013: Payment Flow Mocking

- **Datum:** 2026-02-25
- **Kontext:** Echte Zahlungsanbieter (Stripe, PayPal) führen bei extremer Last durch API-Rate-Limits oft zu Engpässen.
- **Entscheidung:** Der Payment-Flow wird im Worker durch eine künstliche Latenz (z.B. nicht-blockierender Sleep von 500ms bis 1500ms via `setTimeout` aus `node:timers/promises`) simuliert.
- **Begründung:** Diese simulierte Latenz demonstriert den Hauptvorteil unserer asynchronen Pub/Sub-Architektur perfekt: Selbst wenn die "externe Zahlungsabwicklung" extrem langsam wird und den Worker verlangsamt, kann die Fastify API im Frontend sofort das HTTP 202 (Accepted) Signal geben. Die Pub/Sub Queue fängt den Rückstau ab. Bei einer synchronen Architektur würden an dieser Stelle alle Requests in ein Timeout laufen. Da `setTimeout` via Promises den Event-Loop nicht blockiert (kein Busy Wait), kann der Worker effizient tausende asynchrone Zahlungen gleichzeitig "abwarten", ohne CPU-Ressourcen zu verschwenden.
- **Alternativen:** Keine Verzögerung (unrealistisch für echtes Ticketing), Echter Payment-Provider Testmodus (deren Rate Limits würden den k6 Last-Test zerstören oder fälschen).

---

## ADR-014: Wahl des Cloud Providers (GCP vs. EU-Provider)

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

---

## ADR-015: Custom Error Classes & Secure Error Handling

- **Datum:** 2026-03-04
- **Kontext:** Die API benötigt ein verlässliches Error-Handling. Zum einen müssen erwartbare fachliche Fehler (z.B. "Tickets ausverkauft" -> 409 Conflict) strukturiert an den Client gesendet werden. Zum anderen dürfen interne Systemfehler (500 Fehler, DB Exceptions) in der Produktion niemals echte Fehlermeldungen (Information Leakage) an den Client senden.
- **Entscheidung:** Einführung von abstrakten `AppError` Klassen (in `packages/types`), die von Standard-Errors ableiten und in einem zentralen Fastify Error Handler ausgewertet werden.
- **Begründung:** Der zentrale Error Handler fängt alle Exceptions ab. Wenn `error instanceof AppError`, ist es ein "Operational Error" und darf sicher (inkl. Status Code und Message) zum Client geschickt werden. Ist es ein unbekannter Fehler und `NODE_ENV === "production"`, verdeckt der Handler die echte Nachricht mit einem generischen "Internal Server Error" 500. Das schützt interne Infrastruktur-Details.
- **Alternativen:** Try/Catch in jeder einzelnen Route (zu viel Boilerplate, fehleranfällig).

---

## ADR-016: GCP-Ready Structured Logging mit Pino

- **Datum:** 2026-03-04
- **Kontext:** Für Observability und Fehlersuche müssen Logs strukturiert in der Cloud (GCP Stackdriver / Cloud Logging) ankommen. Fastify nutzt standardmäßig Pino.
- **Entscheidung:** Pino wird so konfiguriert, dass das Standardfeld `level` (ein Integer bei Pino) zu einem GCP-kompatiblen Feld `severity` (z.B. "INFO", "ERROR") umgeschrieben wird.
- **Begründung:** Cloud Logging parst Pino's rohes JSON automatisch. Wenn jedoch das `severity`-Feld fehlt, werden alle Logs in der GCP UI standardmäßig als wertloses "DEFAULT" oder "INFO" klassifiziert, auch wenn es fatale Fehler sind. Die Mapping-Config sichert 100%ige Kompatibilität zur GCP-Log-Analyse ohne Performance-Verlust. Alle Logs enthalten zudem automatisch die Fastify `reqId`, um Requests über API und Worker tracebar zu machen.
- **Alternativen:** Winston oder Morgan statt Pino (unnötiger Overhead, Pino ist in Fastify integriert und der schnellste Node Logger), externer Log-Agent (zu viel DevOps Overhead für dieses Setup).

---

## ADR-017: Order-Status via Polling (kein SSE)

- **Datum:** 2026-03-12
- **Kontext:** Das Ticket-Kaufen ist asynchron (Pub/Sub + Worker). Der Client braucht eine verlässliche Rueckmeldung, ob der Kauf abgeschlossen ist, ohne die API-Request-Latenz zu erhoehen oder den Worker direkt mit dem Browser zu verbinden.
- **Entscheidung:** Die API liefert beim Kauf ein `orderId` (z.B. aus dem Request oder generiert) und der Client pollt einen Status-Endpunkt (`GET /api/orders/{orderId}`) bis `completed|failed` erreicht ist.
- **Begruendung:** Polling ist einfach, robust und passt zur entkoppelten Architektur. Der Worker schreibt den finalen Status in die Datenbank (und optional in Redis) und die API liest den Status fuer den Client. Kein direkter Worker-Client-Kanal, keine zusaetzliche Persistenz fuer SSE-Verbindungszustand.
- **Alternativen:**
  - **Server-Sent Events:** wuerde einen dauerhaften API-Client-Kanal erfordern und zusaetzliche Infrastruktur/State-Management (Reconnect, Lastverteilung) benoetigen.
  - **WebSockets:** aehnlich wie SSE, aber komplexer im Betrieb, besonders unter Lastspitzen.
  - **Kein Status-Feedback:** schlechter UX und fuer das Demo-Szenario unzureichend.

  ***

  ## ADR-018: Ticket-Kauf via SQL-Function im Worker
  - **Datum:** 2026-03-12
  - **Kontext:** Der Worker hat zuvor eine Drizzle-Transaktion mit `INSERT` und `UPDATE` ausgefuehrt. Die Logik soll atomar und nah an der DB bleiben.
  - **Entscheidung:** Der Worker ruft eine PostgreSQL-Function `buy_ticket(event_id, first_name, last_name)` auf.
  - **Begruendung:** Die DB kapselt die gesamte Write-Logik in einer atomaren Operation. Das reduziert Roundtrips und vereinfacht den Worker-Code.
  - **Alternativen:** Drizzle-Transaktion im Worker (mehr ORM-Code, gleiche Semantik), separate Stored Procedures pro Schritt (mehr Komplexitaet).
