# ADR-010: Terraform für Infrastructure as Code (IaC)

- **Datum:** 2026-02-25
- **Kontext:** Das Projekt soll realistisch in der Google Cloud (GKE, Cloud SQL, Memorystore, Pub/Sub) laufen. Für das Portfolio und die Reproduzierbarkeit muss das Infrastruktur-Setup code-basiert, versioniert und wiederholbar sein.
- **Entscheidung:** Terraform für das gesamte Cloud-Ressourcen-Management. Kubernetes-Manifeste werden über klassische YAML-Dateien (oder Helm) via Kubeconfig angewendet, nachdem Terraform den GKE Cluster provisioniert hat.
- **Begründung:** Terraform ist der unangefochtene Industrie-Standard für Cloud-agnostische, aber Cloud-native Infrastruktur. Es ermöglicht ein sauberes Setup von VPCs, IAM und den gemanagten Services (Cloud SQL, Redis, Pub/Sub).
- **Alternativen:**
  - _Google Cloud Deployment Manager:_ Veraltet, wird kaum noch genutzt.
  - _Pulumi:_ Moderner (TypeScript), aber Terraform ist aktuell noch der de-facto Standard, den Recruiter/Seniors bevorzugen.
  - _ClickOps (GCP Console):_ Nicht reproduzierbar, keine Versionierung (absolutes No-Go für ein Showcase-Projekt).
- **Nachtrag (2026-08-26, Phase 5.1 — lokale Vorstufe):** Die Reihenfolge „Manifeste werden angewendet, nachdem Terraform den GKE-Cluster provisioniert hat" wird ergaenzt, nicht ersetzt: Die Kubernetes-Manifeste (`k8s/`) entstehen und werden zuerst gegen einen lokalen kind-Cluster geprobt (ADR-038), bevor Terraform in Phase 5.4 den GKE-Cluster anlegt. Terraform bleibt fuer alle Cloud-Ressourcen zustaendig; der lokale Cluster ist kein Terraform-Ziel. Die Manifeste sind fuer beide Ziele dieselben, unterschieden nur durch `kubectl`-Kontext und Env-Profil (ADR-034).
