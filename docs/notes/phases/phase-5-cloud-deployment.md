# Phase 5: Cloud Deployment (GCP)

Offene Detailnotiz zum Cloud-Deployment aus Phase 5. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md). Die Anforderungen an das Zielbild („in der Cloud genauso weit wie lokal") stehen als REQ-D01–D06 in [`docs/REQUIREMENTS.md`](../../REQUIREMENTS.md).

### Roter Faden der Sub-Phasen (geplant 2026-08-18)

Alles, was lokal beweisbar ist, passiert lokal, bevor Cloud-Kosten anfallen;
die Cloud kommt erst, wenn Manifeste **und** Messkette geprobt sind; die teure
50k-Frage kommt erst, wenn die Paritaets-Baseline den Vergleichsanker gesetzt
hat. Jede Sub-Phase bekommt einen eigenen Planungs-Thread — diese Notiz haelt
nur fest, **welche Entscheidungen wann** faellig sind und welche ADRs sie
beruehren. Phase 4.11 wurde hierher aufgeloest (Messkette → 5.3,
Monitoring → 5.5, verteilter Generator → 5.7); die Freigabe-Regel aus deren
[Vorspann](../backlogs/cloud-report-automation.md#backlog-report-automation-cloud-faehig-vorspann)
— Cloud-Arbeit erst nach gemeinsamer GCP-Einarbeitung — gilt fuer 5.4–5.7.

| Sub-Phase | Kern | Faellige Entscheidungen (ADR-Bezug) |
| --------- | ---- | ----------------------------------- |
| 5.1 Containerisierung + lokales k8s | Dockerfiles (`dist`-Runtime, ADR-019; Build in GitHub Actions, ADR-007), Manifeste, 1 Replica; Datenstores + Prometheus bleiben Compose | Lokaler Cluster als Vorstufe: **Nachtrag zu ADR-010** (dessen Reihenfolge „Manifeste nach Terraform-GKE" wird ergaenzt, nicht ersetzt); neues `k8s/`-Verzeichnis in DOCS.md routen |
| 5.2 Multi-Replica-Korrektheit | N API-Replicas + Ingress, Funktions- statt Kapazitaetstests | **Zeitquellen-Entscheidung** (eine fuer beide Grenzen): Sale-Unlock (ADR-024, entschieden mit NTP-Toleranz) und Checkout-Deadline/Reaper-Identitaet (ADR-033, drei Prozessuhren) — Toleranz dokumentieren (Nachtraege) oder autoritative Uhr (superseding ADR). Uhr-Drift ist auf einem lokalen Host **nicht reproduzierbar**; der Nachweis gehoert zu 5.6. **Instanzzahl je Komponente** (REQ-D02): Worker-Skalierung ist per ADR-004 erlaubt und per ADR-031 korrektheitsfrei, aber ineffizient (N× Auditor-/`COUNT`-Zyklen) — bewusste Wahl dokumentieren. Graceful Shutdown/Drain (Phase-6-Todo) ist Vorbedingung fuer Rolling Updates. |
| 5.3 Messkette umgebungsunabhaengig | `docker exec`-Zugriffspfade (Snapshots, Preflight-Container-Check, Reset/Seed, Prometheus-TSDB-Wipe) und die Sold-out-Quelle (ADR-025: ein einzelner monotoner Worker-Counter) austauschbar machen; Aggregationsfehler bei N Instanzen fixen (`instantQuery` nimmt erste Serie; Dashboards `sum()` ueber replizierte Auditor-Gauges → wuerde REQ-C03 falsch anzeigen) | Zugriffspfad-Abstraktion ist eine **neue Entscheidung → eigener ADR** (kein ADR deckt die heutigen `docker exec`-Pfade) |
| 5.4 Cloud-Fundament | IaC fuer VPC, DB, Cache, GKE, echtes Pub/Sub, Registry, Secrets; Deploy der 5.1/5.2-Manifeste; Smoke-E2E-Kauf; vollstaendiger Abbau | **ADR-010-Nachtrag** (Registry + Secret-Verwaltung fehlen dort); **ADR-005-Randbedingung**: Cache **nicht geclustert** (Lua mischt Hash-Slots); **ADR-003**: DB-Wahl Cloud SQL schreibt den Spanner-Nebenpfad faktisch ab — explizit machen; **ADR-034-Nachtrag**: Cloud-Profil + Secret-Handling (dort bewusst out of scope); **Redis-HA/Persistenz** (ADR-031 klammert es aus; Redis ist einzige Inventarautoritaet); Rolling-Update-Reihenfolge bei `DROP+CREATE FUNCTION` (ADR-023-Nachtrag) beachten |
| 5.5 Cloud-Monitoring | Monitoring-Quelle fuer den Cloud-Lauf + Grafana/Renderer-Story (Panel-Evidenz aus REQ-O04 Punkt 5, ADR-030) | **Neuer ADR** fuer die Cloud-Quelle; ADR-006 galt dem lokalen Setup (Phasen 0–4), bleibt dafuer gueltig und erhaelt einen Nachtrag |
| 5.6 Cloud-Baseline Paritaet | `spike:report` in der Cloud mit dem Referenzprofil, Vergleich per `spike:compare` | Vorbedingung: **valide lokale Referenz-Baseline auf dem konsolidierten Profil** (offenes 4.12-Todo; ADR-035 macht Alt-Baselines unvergleichbar). Hier faellt auch der Zeitquellen-Nachweis aus 5.2 (echte Pod-Uhren). In der Cloud sind Duplicate Deliveries dauerhaft erwartet (ADR-023) — Paritaet heisst: Idempotenz absorbiert sie, nicht: sie sind null. |
| 5.7 Cloud-Zielprofil | Verteilter Generator (mehrere Knoten, **Quantil-Merge ueber Teil-Summaries** — der fachlich harte Teil), 50k-Lauf nach REQ-P02; Ergebnis-Metriken fuer die README | **Kapazitaets-Entscheidung** fuer den 50k-Lauf (1M Tickets sind bei 50k RPS in Sekunden ausverkauft; ADR-025/ADR-035 lassen den Lauf bei `SEED_CAPACITY` enden). Haengt an den offenen 4.12-Todos (Transportfehler Buy-Bein, Valid-Baseline). |

### Sale-Unlock-Zeitquelle bei mehreren API-Replicas

> - [ ] **Sale-Unlock-Zeitquelle bei `API replicas > 1` (ADR-024):** Der `opensAt`-Gate-Check vergleicht aktuell gegen `nowMs`, das die API aus `Date.now()` uebergibt — nicht gegen `redis.call("TIME")` im Lua-Script. Das haelt das Script unabhaengig von Redis' Lua-Replikationsverhalten und erlaubt, denselben Zeitstempel als `queuedAt` im Pub/Sub-Payload wiederzuverwenden (ein `Date.now()` pro Request statt zwei). Trade-off: Der Verkaufsstart oeffnet nur so praezise, wie die Uhren der API-Pods synchron sind; bei Uhr-Drift faellt der Unlock pro Pod um die Drift-Spanne unterschiedlich. Lokal (ein Prozess) irrelevant, in GKE deckt NTP-Sync die geforderte Sekunden-Genauigkeit. **Extension:** Falls sub-sekunden-exakter, prozessuebergreifend identischer Unlock gefordert wird, auf `redis.call("TIME")` (eine autoritative Uhr) umstellen — dann entfaellt die `queuedAt`-Wiederverwendung und es faellt ein zweiter Zeitstempel-Roundtrip an; ADR-024 entsprechend aktualisieren.
