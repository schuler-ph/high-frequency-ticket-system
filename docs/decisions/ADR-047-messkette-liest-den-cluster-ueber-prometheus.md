# ADR-047: Die Messkette liest den Cluster über Prometheus

- **Status:** Umgesetzt
- **Datum:** 2026-10-04
- **Baut auf:** ADR-006 (Prometheus + Grafana), ADR-025 (reaktive
  Sold-out-Orchestrierung), ADR-038 (kind als lokaler Cluster)
- **Kontext:** Seit Phase 5.2 laufen API und Worker als Deployments in kind,
  die API mit drei Replicas. Gemessen wird nur noch gegen den Cluster. Die
  Messkette (`spike:report`, `pnpm spike`) war aber für je einen Host-Prozess
  gebaut und brach an fünf Stellen:
  1. **Snapshots** vor und nach dem Lauf lasen `/metrics` über einen
     `port-forward` auf den Service. Ein Service beantwortet jeden Abruf von
     einem beliebigen Pod. Vorher und nachher kommen dann von verschiedenen
     Pods, und die Beiträge der anderen fehlen ganz.
  2. **Die Sold-out-Quelle** (ADR-025) las `orders_completed_total` und den
     Ledger über dieselbe Worker-URL.
  3. **`instantQuery`** nahm stillschweigend die erste Serie. `up{job="api"}`
     hat jetzt drei.
  4. **Der TSDB-Reset** stoppte `hfts-prometheus` per `docker stop`, leerte das
     Volume und startete neu. Prometheus läuft aber nicht mehr in Compose.
  5. **Der Preflight** prüfte Container und die beiden Host-URLs, nicht ob
     jeder Pod bereit ist und gescrapt wird.

- **Entscheidung:** Jede Service-Metrik, die die Messkette braucht, kommt aus
  Prometheus. Prometheus scrapt jeden Pod einzeln und ist damit die einzige
  Stelle, die alle Pods kennt. Umgebaut wird nur, was der Cluster bricht.
  1. **Snapshots** sind der vollständige Instant-Vektor eines Jobs
     (`{job="api"}` ohne `up` und `scrape_*`), zurückgeschrieben ins
     Text-Exposition-Format. `job` entfällt, `instance` (der Pod-Name) bleibt.
     Die reine Analyse parst die `.prom`-Dateien unverändert; `sumSamples` und
     `getHistogram` addierten schon immer alle passenden Serien, also jetzt
     die der Pods. Goldens und Fixtures bleiben gültig.
  2. **Sold-out und Drain** lesen aggregierte Instant Queries:
     `sum(orders_completed_total{…})`, `sum(payments_confirmed_total{…})`,
     `max(reservation_ledger_active{…})`. Gepollt wird im Scrape-Takt (5 s);
     schneller sähe der Plateau-Detektor denselben Scrape zweimal.
  3. **`instantQuery` verweigert mehrere Serien** mit einem Fehler. Jede
     Abfrage aggregiert nach der Regel aus dem
     [Dashboard-Audit](../reports/dashboard-aggregation-2026-10-04.md):
     Beitrag `sum`, Weltzustand `max`, „alle oben" `min`.
  4. **Der TSDB-Reset** läuft über die Admin-API (`delete_series` für alle
     Serien, dann `clean_tombstones`). Danach wartet die Messkette, bis die
     Targets-API für **jeden** Pod einen Scrape nach dem Reset meldet; sonst
     fehlten Pods im Vorher-Snapshot. Der erste Smoke-Lauf gegen den Cluster
     prüfte nur den ältesten Zeitstempel der noch vorhandenen Serien und nahm
     den Snapshot mit einem von drei API-Pods und ohne Worker.
  5. **Der Preflight** prüft per `kubectl --context $K8S_CONTEXT`, dass jedes
     gewünschte Replica bereit ist, und per Prometheus, dass genauso viele
     Targets `up` sind. Dazu einen HTTP-Abruf durch das Gateway. Alles vor dem
     Reset, wie bisher.
  6. **Die Pods laufen das Profil des Laufs.** Der Preflight liest
     `HFTS_ENV` aus dem Pod-Template (explizites `env` vor der ConfigMap) und
     bricht ab, wenn es nicht das Profil des Laufs ist oder ein Rollout noch
     läuft. `pnpm k8s:profile` setzt es per `kubectl set env` auf API und
     Worker und wartet auf den Rollout. Das Profil steuert Dinge, die k6 nie
     sieht: Checkout-Deadline, Reaper-Takt, Pool-Größe, Flow Control. Mit dem
     Host-Prozess-Setup startete jeder Service mit `HFTS_ENV=<profil>`; im
     Cluster trug die ConfigMap fest `dev`.

- **Was bis Modul 8 an `docker exec` hängt:** Reset und Seed von PostgreSQL und
  Redis, die Zustands-Snapshots (`snapshotPostgres`, `snapshotRedis`) und das
  Live-`available` für die Plateau-Klassifikation. Die Datastores bleiben in
  Compose, also funktioniert der Zugriff lokal unverändert. In GKE gibt es
  diese Container nicht; dort wird er zum Job oder zum Cloud-SQL-Proxy.

- **Begründung:**
  - Prometheus ist in jeder Umgebung dieselbe Schnittstelle. Ein Tunnel je Pod
    oder `kubectl exec` je Pod hinge an kind und an der Pod-Liste zum
    Zeitpunkt des Abrufs.
  - Das Exposition-Format als Austauschformat hält die Analyse rein und die
    Belege lesbar: Die `.prom`-Datei zeigt weiterhin jede Serie, jetzt mit dem
    Pod, der sie meldete.
  - Ein harter Fehler bei mehreren Serien macht einen Abfragefehler sichtbar,
    statt einen einzelnen Pod als ganzes System auszugeben.

- **Alternativen:**
  - **`kubectl port-forward` je Pod:** Pod-Namen ändern sich bei jedem
    Rollout, und der Tunnel misst unter Last vor allem sich selbst.
  - **`increase()` über das Lauffenster statt Vorher/Nachher-Snapshot:** würde
    Pod-Neustarts im Lauf korrekt behandeln, verlangt aber eine neue Analyse
    und neue Goldens. Stattdessen hält `health.json` die Pod-Namen vor und nach
    dem Lauf fest (`pods`, `podsChanged`), und die Konsole warnt, wenn sie sich
    ändern. Ein Neustart zeigt sich außerdem als Abweichung von publiziert zu
    persistiert und damit im System-Verdict.
  - **TSDB-Reset per Pod-Neustart:** gibt den Heap frei, kostet aber Sekunden
    bis zur ersten Scrape und koppelt die Messkette an `kubectl rollout`. Der
    Heap ist seit dem opt-in für k6-Remote-Write (Baseline B) kein Engpass
    mehr.

- **Konsequenzen:**
  - `kubectl set env` steht nicht in den Manifesten. `pnpm k8s:apply` lässt
    das gesetzte Profil stehen; zurück auf `dev` geht es mit
    `HFTS_ENV=dev pnpm k8s:profile` oder `kind:recreate`.
  - `API_METRICS_URL` und `WORKER_METRICS_URL` entfallen in den
    Lasttest-Profilen. Neu ist `K8S_CONTEXT`; `BASE_URL` zeigt auf den
    Gateway-Eingang (`localhost:10000`). Kein Tunnel ist mehr nötig.
  - Die Vorher-/Nachher-Werte sind höchstens ein Scrape-Intervall alt. Für den
    Vorher-Snapshot erzwingt die Frische-Prüfung einen Scrape nach dem Reset;
    für den Nachher-Snapshot liegt der Drain mit drei stabilen Polls à 5 s
    davor.
  - `pnpm bench:hot-row` liest weiter `BENCH_WORKER_METRICS_URL` und braucht
    damit einen Tunnel auf den Worker. Es misst einen einzelnen Worker und ist
    nicht Teil der Messkette.
