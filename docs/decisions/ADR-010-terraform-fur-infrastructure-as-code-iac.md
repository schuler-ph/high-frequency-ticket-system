# ADR-010: Terraform für Infrastructure as Code (IaC)

- **Datum:** 2026-02-25
- **Kontext:** Das Projekt soll realistisch in der Google Cloud (GKE, Cloud SQL, Memorystore, Pub/Sub) laufen. Für das Portfolio und die Reproduzierbarkeit muss das Infrastruktur-Setup code-basiert, versioniert und wiederholbar sein.
- **Entscheidung:** Terraform für das gesamte Cloud-Ressourcen-Management. Kubernetes-Manifeste werden über klassische YAML-Dateien (oder Helm) via Kubeconfig angewendet, nachdem Terraform den GKE Cluster provisioniert hat.
- **Begründung:** Terraform ist der unangefochtene Industrie-Standard für Cloud-agnostische, aber Cloud-native Infrastruktur. Es ermöglicht ein sauberes Setup von VPCs, IAM und den gemanagten Services (Cloud SQL, Redis, Pub/Sub).
- **Alternativen:**
  - _Google Cloud Deployment Manager:_ Veraltet, wird kaum noch genutzt.
  - _Pulumi:_ Moderner (TypeScript), aber Terraform ist aktuell noch der de-facto Standard, den Recruiter/Seniors bevorzugen.
  - _ClickOps (GCP Console):_ Nicht reproduzierbar, keine Versionierung (absolutes No-Go für ein Showcase-Projekt).
