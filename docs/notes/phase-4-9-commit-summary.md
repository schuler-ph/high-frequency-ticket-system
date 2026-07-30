# Phase 4.9 – Zusammenfassung der letzten acht Commits

Stand: 2026-07-30

Die acht Commits ersetzen den schreibenden Redis/PostgreSQL-Reconcile durch ein Redis-autoritäres Inventory-Modell mit read-only Audit, separatem Sold-Count-Projector und abgesichertem Checkout-Lifecycle.

| Commit    | Kurzfassung                                                                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aeb4c1e` | Phase 4.9 geplant und Architektur, Anforderungen, ADRs sowie Todos auf Audit statt Reconcile ausgerichtet.                                                                  |
| `d5fc304` | Die finale Capacity-Invariante als eigenen Lasttest-Verdict-Check ergänzt und mit Analyse-/Golden-Tests abgesichert; außerdem wurde ein Phase-5-Erklärdokument aufgenommen. |
| `3516a68` | Read-only Inventory-Auditor und Sold-Count-Projector als getrennte, getestete Komponenten eingeführt.                                                                       |
| `71e2c5d` | Schreibenden Reconcile samt Startup-Blocker und Scheduler entfernt und durch einen unabhängigen Inventory-Zyklus ersetzt.                                                   |
| `d5ec0e4` | Checkout-Zustände `pending → publishing → paid` und einen atomaren Pay-Claim per Redis Lua eingeführt; Cancel und Rollback wurden zustandsgebunden.                         |
| `0b505c4` | Einen atomaren Pending-Reaper mit exakter Deadline, Metriken sowie echten Redis-Race-Tests für Pay, Cancel und Reaper umgesetzt.                                            |
| `d24400c` | Die Grafana-Dashboards um Inventory-Integrität, Auditor/Reaper-Health und Sold-Count-Projector-/DB-Signale erweitert.                                                       |
| `14a29ea` | Verbindliche Repo-Regel ergänzt: Last- und Kapazitätstests dürfen nur nach ausdrücklicher Freigabe für den konkreten Lauf gestartet werden.                                 |

Der Implementierungsstand ist durch Unit-, Integrations-, Redis-Race- und E2E-Tests abgesichert. Ein vollständiger Abschluss-Lasttest ist weiterhin offen und darf nur manuell beziehungsweise nach expliziter Nutzerfreigabe ausgeführt werden.
