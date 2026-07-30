# Phase 5: Cloud Deployment (GCP)

Offene Detailnotiz zum Cloud-Deployment aus Phase 5. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

### Sale-Unlock-Zeitquelle bei mehreren API-Replicas

> - [ ] **Sale-Unlock-Zeitquelle bei `API replicas > 1` (ADR-024):** Der `opensAt`-Gate-Check vergleicht aktuell gegen `nowMs`, das die API aus `Date.now()` uebergibt — nicht gegen `redis.call("TIME")` im Lua-Script. Das haelt das Script unabhaengig von Redis' Lua-Replikationsverhalten und erlaubt, denselben Zeitstempel als `queuedAt` im Pub/Sub-Payload wiederzuverwenden (ein `Date.now()` pro Request statt zwei). Trade-off: Der Verkaufsstart oeffnet nur so praezise, wie die Uhren der API-Pods synchron sind; bei Uhr-Drift faellt der Unlock pro Pod um die Drift-Spanne unterschiedlich. Lokal (ein Prozess) irrelevant, in GKE deckt NTP-Sync die geforderte Sekunden-Genauigkeit. **Extension:** Falls sub-sekunden-exakter, prozessuebergreifend identischer Unlock gefordert wird, auf `redis.call("TIME")` (eine autoritative Uhr) umstellen — dann entfaellt die `queuedAt`-Wiederverwendung und es faellt ein zweiter Zeitstempel-Roundtrip an; ADR-024 entsprechend aktualisieren.
