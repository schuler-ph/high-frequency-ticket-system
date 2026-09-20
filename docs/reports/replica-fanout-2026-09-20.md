# Messung: Lastverteilung und Metrik-Kardinalität bei drei API-Replicas

Stand: 2026-09-20 · Scope: Phase 5.2 — erster Multi-Replica-Lauf im lokalen kind-Cluster

Erste Messung, nachdem die API von einer auf drei Replicas gegangen ist. Sie beantwortet zwei Fragen, die Phase 5.3 als Eingabe braucht: Wie verteilt Envoy die Requests, und wie viele Prometheus-Zeitreihen entstehen pro Replica?

## Aufbau

| Komponente   | Zustand                                                                        |
| ------------ | ------------------------------------------------------------------------------ |
| Cluster      | kind `hfts`, ein Node                                                          |
| API          | 3 Replicas, `replicas` im Overlay `local` gesetzt, `base` bleibt bei 1         |
| Worker / Web | je 1 Replica                                                                   |
| Eingang      | Envoy Gateway v1.9.1, Listener-Port 10000, `HTTPRoute` `/api` → `svc/api`      |
| Datenstores  | Redis, PostgreSQL, Pub/Sub-Emulator in Compose, erreicht über die Host-Adresse |
| Last         | 100 × `GET /api/tickets/:eventId/availability`, sequenziell über das Gateway   |

## Befund 1 — Verteilung über die Replicas

| Pod                    | Requests |
| ---------------------- | -------- |
| `api-744f67b6f8-lljjv` | 25       |
| `api-744f67b6f8-nk7lm` | 37       |
| `api-744f67b6f8-pf8g7` | 38       |
| **Summe**              | **100**  |

Die Summe der Per-Pod-Deltas trifft die gesendete Menge exakt; jeder Request ist genau einem Pod zuzuordnen.

Die Verteilung ist mit 25 zu 38 deutlich schief. Das ist kein Fehlverhalten: Envoy Gateway balanciert per Default nach **Least Request** (Power of Two Choices), nicht nach Round Robin. Das Auswahlkriterium „wenigste offene Requests" ist bei sequenzieller Last ohne Nebenläufigkeit fast immer null, die Wahl damit praktisch zufällig. Round Robin hätte 34/33/33 ergeben. Für Kapazitätsaussagen heißt das: Eine schiefe Verteilung bei kleiner, sequenzieller Last ist erwartbar und kein Hinweis auf einen ungesunden Pod.

## Befund 2 — Keep-alive ändert die Verteilung nicht

Dieselben 100 Requests über eine einzige wiederverwendete HTTP/1.1-Verbindung: **28 / 39 / 33**, also unverändert verteilt.

Der Grund ist die Proxy-Ebene. **Envoy terminiert die Downstream-Verbindung und entscheidet pro Request neu**, gegen einen eigenen Upstream-Connection-Pool. Downstream-Keep-alive und Upstream-Auswahl sind entkoppelt.

Die gegenteilige Erwartung gilt für **L4**-Balancing: Ein ClusterIP-Service wird von kube-proxy per iptables/IPVS **pro TCP-Verbindung** an einen Pod gebunden. Eine langlebige Keep-alive-Verbindung bleibt dort für ihre gesamte Lebensdauer auf demselben Pod. Das ist die Eigenschaft, die der nginx-`proxy_pass`-Weg gehabt hätte und die das Gateway nicht hat — relevant für jede Komponente, die Verbindungen poolt und über einen Service statt über das Gateway spricht.

## Befund 3 — Kardinalität von `http_request_duration_seconds`

Das Histogramm ist mit 11 Buckets definiert (`apps/api/src/lib/metrics.ts`). Pro Labelkombination aus `method`, `route` und `status_code` entstehen damit **14 Zeitreihen**: 11 Buckets + `+Inf` + `_sum` + `_count`.

| Zustand                     | Zeitreihen                              |
| --------------------------- | --------------------------------------- |
| 1 Replica, 4 Kombinationen  | 56                                      |
| 3 Replicas, 4 Kombinationen | 168 (gemessen)                          |
| 1 Replica, 7 Kombinationen  | 98 (gemessen, Pod mit Checkout-Verkehr) |
| 3 Replicas, 7 Kombinationen | 294 (Hochrechnung)                      |

Eine neue Labelkombination — etwa ein bisher ungesehener Statuscode auf einer bestehenden Route — kostet 14 Serien auf einmal, nicht eine. Die Kopien unterscheiden sich allein im `instance`-Label.

Nebenbefund: Auf einem Pod ohne Checkout-Verkehr entfallen über 90 % der beobachteten Requests auf `/health` und `/ready`. Ein Latenz-Panel, das nicht nach `route` filtert, misst überwiegend die eigenen Kubernetes-Probes.

## Konsequenz für Phase 5.3

Dieselbe Vervielfachung hat je nach Metriktyp entgegengesetzte Folgen:

- **Histogramm-Buckets sind Counter** und dürfen über Instanzen summiert werden. `histogram_quantile(0.99, sum by (le) (rate(...[1m])))` ist über N Replicas korrekt; der Preis ist die Bucket-Auflösung.
- **Ein Gauge, der einen Weltzustand misst** — Auditor-Delta, Ledger-Größe, Drift — wird von jeder Instanz identisch gemeldet. `sum()` darüber multipliziert ihn mit der Replica-Zahl. Richtig sind `max()` oder `avg()`, oder die Metrik bleibt Singleton.

Die Panel-für-Panel-Klassifikation entlang dieser Grenze ist Gegenstand von Phase 5.3.

## Methodischer Hinweis zur Wiederholung

Zwei Fallen haben beim ersten Versuch stille Fehlmessungen erzeugt:

1. **Ein port-forward pro Pod, auf je eigenem lokalen Port.** Mehrere Tunnel nacheinander auf denselben Port bringen den zweiten und dritten zum sofortigen Beenden; alle Abfragen laufen dann unbemerkt durch den ersten Tunnel und zeigen dreimal denselben Pod. Gegenprobe: Die Pods müssen sich in mindestens einer Zahl unterscheiden.
2. **Deltas messen, keine Absolutwerte.** Pods unterschiedlichen Alters haben unterschiedliche Zählerstände, und die Probes erhöhen sie während der Messung weiter.
