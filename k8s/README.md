# Kubernetes-Manifeste

Deployments, Services und Probes des Systems. Lokal laufen sie gegen einen
kind-Cluster ([ADR-038](../docs/decisions/ADR-038-kind-als-lokaler-kubernetes-cluster.md)),
später gegen GKE. Die Datenstores liegen lokal weiterhin in `docker-compose.yml`
und werden über die Host-Adresse erreicht.

## Aufbau

| Pfad              | Inhalt                                                        |
| ----------------- | ------------------------------------------------------------- |
| `base/`           | die Objekte selbst: Deployments, Services, Probes, Ressourcen |
| `overlays/local/` | kind: Adressen der Compose-Stores, lokales Secret, 1 Replica  |
| `overlays/cloud/` | GKE: Cloud-Adressen, Secret aus dem Cluster, Replica-Zahl     |

In `base/` steht, was in jeder Umgebung gleich ist. Alles, was sich zwischen
lokal und Cloud unterscheidet — Adressen, Secrets, Replica-Zahl, Gateway —
gehört ins Overlay und nicht in `base/`.

## Anwenden

```bash
kubectl apply -k overlays/local
kubectl apply -k overlays/cloud
```

Die vollständige Befehlsfolge inklusive Cluster-Start, `kind load` und
Diagnose steht im [Befehlsblatt](../docs/notes/sheets/k8s.md).

## Konfiguration

Das Env-Profil reist im Image mit und wird über `HFTS_ENV` gewählt. Prozess-Env
schlägt die Profil-Datei (`override: false` in `packages/env/src/load-profile.ts`),
deshalb überschreiben ConfigMap und Secret aus dem Overlay gezielt einzelne
Werte, ohne dass ein eigenes Profil je Cluster nötig ist.

Zugangsdaten gehören ins Secret, nicht in `base/`. Ein Kubernetes-Secret ist
base64-kodiert, nicht verschlüsselt — mit echten Werten gehört es nicht ins
Repository.

# Befehlsblatt: Kubernetes lokal (kind)

Nachschlagewerk für Phase 5.1: die Befehle, die beim Arbeiten am lokalen
Cluster immer wieder gebraucht werden. Keine Begründungen — die stehen in
[ADR-038](../../decisions/ADR-038-kind-als-lokaler-kubernetes-cluster.md) und
in der [Phasennotiz](../phases/phase-5-cloud-deployment.md).

Die Datenstores bleiben in Compose. Der Cluster erreicht sie über die
Host-Adresse `host.docker.internal` und die Compose-Host-Ports.

## Voraussetzungen vor jedem Lauf

```bash
docker compose up -d
docker compose ps                        # postgres, redis, pubsub healthy?
HFTS_ENV=dev pnpm run provision          # Topic und Subscription anlegen
```

Ohne Topic beendet sich der Worker mit `process.exit(1)` (ADR-044); im Cluster
erscheint das als `CrashLoopBackOff`.

## Images bauen und in den Cluster laden

```bash
pnpm --filter worker run docker:build    # analog: api, web
pnpm run docker:build                    # alle drei über Turbo

kind load docker-image hfts-worker:dev --name hfts
kind load docker-image hfts-api:dev --name hfts
kind load docker-image hfts-web:dev --name hfts
```

Nach jedem Rebuild erneut laden. Ein `kubectl rollout restart` allein zieht
kein neues Image.

## Cluster

```bash
kind create cluster --name hfts
kind get clusters
kubectl cluster-info
kubectl config current-context
kind delete cluster --name hfts
```

## Anwenden

```bash
kubectl apply -f k8s/base/worker-deployment.yaml
kubectl apply -k k8s/overlays/local
kubectl diff -k k8s/overlays/local        # was würde sich ändern?
kubectl delete -k k8s/overlays/local
```

## Ansehen

```bash
kubectl get pods
kubectl get pods -o wide                  # Node und Pod-IP
kubectl get pods -w                       # laufend, Ctrl-C beendet
kubectl get deploy,svc,cm,secret
kubectl get pod <name> -o yaml            # was der Server wirklich gespeichert hat
```

## Die Diagnose-Schleife

```bash
kubectl describe pod -l app=worker        # Events stehen am Ende
kubectl logs -l app=worker --tail=50
kubectl logs -l app=worker -f             # mitlaufen
kubectl logs <pod> --previous             # Logs des abgestürzten Vorgängers
kubectl get events --sort-by=.lastTimestamp
```

`--previous` ist bei `CrashLoopBackOff` der wichtigste Schalter: der laufende
Container ist neu und hat den Fehler noch nicht wiederholt.

## Hineinschauen und erreichen

```bash
kubectl exec -it <pod> -- sh
kubectl exec <pod> -- env | sort          # kam die ConfigMap wirklich an?
kubectl port-forward deploy/api 10002:10002
```

## Rollout

```bash
kubectl rollout status deploy/worker
kubectl rollout restart deploy/worker
kubectl rollout undo deploy/worker
```

## Compose-Host-Ports

| Dienst   | im Compose-Netz | vom Cluster aus              |
| -------- | --------------- | ---------------------------- |
| Redis    | `redis:6379`    | `host.docker.internal:10004` |
| Pub/Sub  | `pubsub:8085`   | `host.docker.internal:10005` |
| Postgres | `postgres:5432` | `host.docker.internal:10006` |

## Wiederkehrende Fallen

- `ErrImagePull` — `kind load docker-image` vergessen oder Tag vertippt.
- Pod startet nicht, Meldung über `selector` — `spec.selector.matchLabels` und
  `spec.template.metadata.labels` stimmen nicht überein.
- Zod meldet `Required` beim Boot — eine Variable fehlt oder ist leer.
  Prozess-Env schlägt die Profil-Datei (`override: false`), ConfigMap und
  Secret überschreiben also `dev.env`.
- `localhost` in einer Adresse — das ist im Pod der Pod selbst, nicht der Mac.
- `kubectl port-forward service/<name>` schlägt bei einem Service ohne
  Selector fehl; der API-Server proxyt nicht auf Endpunkte ohne Pod.
- Ein Secret ist base64, nicht verschlüsselt: mit echten Werten gehört es
  nicht ins Repository.
