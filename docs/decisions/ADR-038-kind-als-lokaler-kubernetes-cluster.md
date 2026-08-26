# ADR-038: kubectl als einziger Cluster-Client, kind als lokaler Kubernetes-Cluster

- **Status:** Geplant
- **Datum:** 2026-08-26
- **Kontext:** Phase 5.1 stellt API, Worker und Web erstmals als Kubernetes-
  Deployments auf, bevor in 5.4 ein GKE-Cluster per Terraform entsteht
  (ADR-010). Dafuer braucht es einen lokalen Cluster. Das Kubernetes-Projekt
  nennt kind und minikube, daneben existieren k3s/k3d, Docker-Desktop-
  Kubernetes, Rancher Desktop und MicroK8s. Diese Werkzeuge liegen auf einer
  anderen Ebene als `kubectl`: `kubectl` ist der Client, der ueber die
  Kubernetes-API mit **jedem** Cluster spricht — lokal wie GKE — und die Ziele
  nur ueber den Kontext in `~/.kube/config` unterscheidet. Die lokalen
  Werkzeuge sind austauschbare Wege, sich einen Cluster zu beschaffen; es
  braucht genau einen. Randbedingungen aus dem Phase-5-Plan: Datenstores,
  Pub/Sub-Emulator und Prometheus bleiben in Docker Compose; Phase 5.2 braucht
  denselben lokalen Cluster fuer mehrere API-Replicas; das Projekt ist ein
  Lernvehikel fuer den GKE-Stack, lokal Gelerntes soll sich also
  unveraendert auf GKE uebertragen.
- **Entscheidung:** `kubectl` ist der einzige Cluster-Client, lokal wie in der
  Cloud; die Manifeste in `k8s/` sind fuer beide Ziele dieselben. Als lokaler
  Cluster-Provider wird **kind** (Kubernetes IN Docker) verwendet.
- **Begründung:**
  - **Docker ist bereits die Laufzeitumgebung.** kind-Nodes sind selbst nur
    Docker-Container; es kommt kein VM-Layer und kein zweiter Hypervisor dazu.
  - **Vanilla Kubernetes.** kind faehrt die Upstream-Komponenten (etcd,
    kube-apiserver, kube-proxy). Deployments, Services, Probes und
    Ressourcen-Limits verhalten sich wie auf GKE; es gibt keine
    Distributions-Eigenheiten, die man lokal lernt und in der Cloud verlernen
    muss.
  - **Multi-Node per Konfigurationsdatei.** Damit laesst sich Phase 5.2 (N API-
    Replicas, Pod-Verteilung) im selben Cluster proben.
  - **Wegwerfbar.** `kind delete cluster` setzt den Zustand vollstaendig
    zurueck; Experimente kosten nichts.
- **Alternativen (verworfen):**
  - **k3s / k3d:** Abgespeckte Rancher-Distribution (SQLite statt etcd, Traefik
    als eingebauter Ingress, gebuendelte Komponenten), gedacht fuer Edge und
    Eigenbau-Cluster — genau die Rolle, gegen die ADR-014 sich entschieden
    hat. Schnellerer Start als kind, aber Abweichungen vom GKE-Verhalten, die
    hier nur Lernrauschen waeren.
  - **minikube:** Voll funktionsfaehig, auf macOS aber ein Umweg (VM- oder
    Docker-Treiber, eigenes Addon-Oekosystem, `minikube service`-Sonderwege)
    ohne Mehrwert gegenueber kind fuer dieses Setup.
  - **Docker-Desktop-Kubernetes:** Null Installationsaufwand, aber nur ein
    Node, kein Cluster-Neuaufbau ohne Docker-Reset und wenig Einblick in das,
    was passiert — fuer ein Lernziel ungeeignet.
  - **Kein lokaler Cluster, direkt GKE:** Widerspricht dem roten Faden der
    Phase 5 („alles, was lokal beweisbar ist, passiert lokal, bevor Cloud-
    Kosten anfallen").
- **Konsequenzen:** `kubectl` und `kind` sind lokale Voraussetzungen
  (`brew install kubectl kind`) und werden im Runbook bzw. der Preflight-Pruefung
  aufgenommen, sobald `k8s/` existiert. Die in ADR-010 festgelegte Reihenfolge
  „Manifeste nach Terraform-GKE" wird um die lokale Vorstufe ergaenzt
  (ADR-010-Nachtrag 2026-08-26). Erwartete Huerde in 5.1: Pods im kind-Cluster
  muessen die Compose-Datenstores erreichen — ueber `host.docker.internal`
  oder indem der kind-Node ins Compose-Netzwerk gehaengt wird; die dafuer
  noetigen Hosts kommen aus dem Env-Profil (ADR-034), nicht aus den
  Manifesten. Der Wechsel zwischen lokal und GKE ist ein
  `kubectl config use-context`, kein Werkzeugwechsel.
