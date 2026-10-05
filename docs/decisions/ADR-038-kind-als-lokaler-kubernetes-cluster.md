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

## Nachtrag 2026-10-05: Datastores im kind-Netz statt über `host.docker.internal`

Die Pods erreichten Redis, Postgres und den Pub/Sub-Emulator zunächst über
`host.docker.internal` und die Compose-Host-Ports. Jedes Paket lief dabei aus
der VM durch den Userspace-Netzstack von Docker Desktop auf den Mac und über
die Port-Weiterleitung zurück in die VM. Ein Redis-Roundtrip kostete so
0,95 ms statt 0,30 ms direkt aus dem Pod. Unter Last liefen rund 49.000
Redis-Kommandos pro Sekunde und der ganze Postgres-Verkehr doppelt durch diesen
Stack. Er belegte Mac-Kerne, die dem Cluster fehlten, und `buy_ticket` stand im
Worker bei 2 bis 5 s.

Deshalb hängt `pnpm run kind:network` die vier Compose-Container zusätzlich ins
Docker-Netz `kind`. Das lokale Overlay adressiert sie unter ihren
Containernamen (`hfts-redis:6379`, `hfts-postgres:5432`, `hfts-pubsub:8085`,
`hfts-redis-exporter:9121`). Das entspricht der Cloud-Topologie, in der die
Datastores ebenfalls nicht über den Host laufen.

Compose deklariert das Netz bewusst nicht als extern: Der Compose-Stack muss
ohne Cluster startbar bleiben, `pnpm test` braucht ihn ohne kind. Der Preis ist
ein zusätzlicher Schritt. `kind:up` ruft ihn nach `kind:create` auf, nach einem
Neuerzeugen der Compose-Container muss er erneut laufen. Die Compose-Host-Ports
bleiben für Host-Prozesse, Tests und Diagnose bestehen.
