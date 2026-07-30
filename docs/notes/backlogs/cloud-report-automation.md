# Backlog: Report-Automation cloud-faehig machen (Vorbedingung fuer den GCP-Lasttest)

Offene Detailnotiz fuer eine cloud-faehige Lasttest- und Report-Automation.

### Backlog Report-Automation cloud-faehig: Vorspann

> Beim Abarbeiten des Baseline-B-Nachlaufs (2026-07-26) entdeckt: die Report-Automation ist derzeit **lokal-only** und kann gegen GCP nichts erheben. Das ist der eigentliche Grund, warum `pnpm spike:report` nach dem Deployment nicht einfach gegen GKE laeuft. Bewusst als eigener Abschnitt, weil diese Punkte **Terraform/GKE-Kontext** brauchen und laut Absprache erst nach einer gemeinsamen Einarbeitung in GCP angefasst werden.

### State-Snapshots gegen Cloud SQL und Memorystore

> - [ ] **State-Snapshots gegen Cloud SQL / Memorystore:** `scripts/load-test/lib/snapshots.mjs` ist auf `docker exec hts-postgres psql` bzw. `docker exec hts-redis redis-cli` **hart verdrahtet** (Konstanten `POSTGRES_CONTAINER`/`REDIS_CONTAINER`). Gegen Cloud SQL und Memorystore gibt es diese Container nicht — `snapshotPostgres`/`snapshotRedis`/`readAvailableTickets` liefern dort gar nichts. Braucht einen austauschbaren Zugriffspfad (echte Verbindung via `@repo/db`-Pool bzw. Redis-Client statt Container-CLI), damit derselbe pure Analyzer beide Umgebungen bedienen kann.

### Preflight umgebungsabhaengig machen

> - [ ] **Preflight umgebungsabhaengig machen:** `preflight()` in `scripts/load-test/lib/config.mjs` verlangt per Default die laufenden Container `hts-postgres`/`hts-redis`/`hts-pubsub` und bricht in einem Cloud-Lauf sofort ab. Die Signatur nimmt `requiredContainers` bereits als Option — es fehlt ein Cloud-Profil, das stattdessen Erreichbarkeit/Health der echten Endpunkte prueft.

### Seed-Pfad fuer die Cloud

> - [ ] **Seed-Pfad fuer die Cloud:** `scripts/local/reset-seed.mjs` provisioniert Topic/Subscription ueber die **Emulator**-REST-API und truncated per Container-CLI. In GCP provisioniert Terraform (ADR-010), und das Zuruecksetzen des Test-Events braucht einen anderen Weg. Klaeren, ob ein Cloud-Lauf ueberhaupt seeden darf oder gegen einen vorbereiteten Datenstand faehrt.

### Verteilten k6-Runner orchestrieren

> - [ ] **Verteilter k6-Runner orchestrieren:** `spawnK6` startet genau **einen lokalen** k6-Prozess und wertet dessen Exit-Code plus eine `--summary-export`-Datei aus. Fuer das 50k-RPS-Ziel (Stage-4-Todo #244) braucht es mehrere Generator-Knoten und ein Zusammenfuehren der Teil-Summaries, bevor `summarisePhase` sie auswerten kann. Haengt direkt an #244.

### Monitoring-Quelle fuer den Cloud-Lauf

> - [ ] **Monitoring-Quelle fuer den Cloud-Lauf entscheiden:** `report-queries.json` fragt `job="api"`/`job="worker"` gegen einen lokalen Prometheus. In GCP ist zu entscheiden, ob Managed Service for Prometheus, ein selbst betriebener Prometheus im Cluster oder Cloud Monitoring die Quelle ist — und wie `targetUp`/die Range-Queries darauf abbilden. (Der lokale Prometheus ist beim Baseline-B-Lauf am k6-Remote-Write gestorben; das Remote-Write ist inzwischen standardmaessig aus, die Dimensionierungsfrage bleibt fuer die Cloud offen.)
