# Kubernetes-Manifeste

Lokal kind ([ADR-038](../docs/decisions/ADR-038-kind-als-lokaler-kubernetes-cluster.md)),
später GKE. Datenstores bleiben in `docker-compose.yml`, erreichbar über
`host.docker.internal`.

## Aufbau

| Pfad              | Inhalt                                                        |
| ----------------- | ------------------------------------------------------------- |
| `base/`           | Deployments, Services, Probes, Ressourcen — überall gleich    |
| `overlays/local/` | kind: Compose-Adressen, lokales Secret, 1 Replica             |
| `overlays/cloud/` | GKE: Cloud-Adressen, Cluster-Secret, Replica-Zahl             |
| `vendor/`         | fremde Cluster-Ausstattung, nicht versioniert — eigene README |

- Unterschiede zwischen lokal und Cloud gehören ins Overlay, nie in `base/`.
- `base/` nie direkt anwenden — ConfigMap und Secret entstehen erst im Overlay.
- Profil reist im Image mit, Auswahl über `HFTS_ENV`. Prozess-Env schlägt die
  Profil-Datei, ConfigMap und Secret überschreiben also gezielt `dev.env`.
- Secret ist base64, nicht verschlüsselt — echte Werte nie ins Repository.

## Ablauf

Alle Pfade vom Repository-Wurzelverzeichnis.

```bash
docker compose up -d                      # postgres, redis, pubsub
HFTS_ENV=dev pnpm run provision           # Topic + Subscription
pnpm run docker:build                     # oder --filter api|worker|web
pnpm run kind:up                          # Cluster, Images, Gateway, Overlay
kubectl get pods -w                       # beide 1/1 Running
```

`kind:up` kettet vier Schritte, die einzeln dasselbe tun und beim Üben
einzeln nützlich sind:

| Skript            | tut                                                    |
| ----------------- | ------------------------------------------------------ |
| `kind:create`     | nur den Cluster aus `kind.yaml`                        |
| `kind:load`       | die drei `hfts-*:dev`-Images in den Cluster            |
| `gateway:install` | Envoy Gateway aus `vendor/`, wartet auf den Controller |
| `k8s:apply`       | `kubectl apply -k k8s/overlays/local`                  |

`kind:recreate` ist `kind:delete` gefolgt von `kind:up`. Vorher müssen die
Images gebaut sein, sonst bricht die Kette nach dem Cluster ab.

### Images vorladen

`kind:recreate` wirft den Node weg, und mit ihm dessen Image-Cache. Was nicht
vorgeladen ist, wird bei jedem Neuaufbau neu aus dem Internet gezogen. Alle
Images der `install.yaml` stehen auf `imagePullPolicy: IfNotPresent`, deshalb
lädt `kind:load` neben den drei eigenen auch den Controller in den Node.

Einmalige Voraussetzung auf einem frischen Rechner — sonst scheitert
`kind:load`:

```bash
docker pull envoyproxy/gateway:v1.9.1
```

Ein Pull bleibt: Der Controller erzeugt zu jedem `Gateway` eine zweite
Deployment mit dem eigentlichen Envoy-Proxy. Dessen Tag steht nicht in der
`install.yaml`, sondern kommt aus der Controller-Config und ist erst nach dem
ersten `Gateway` sichtbar:

```bash
kubectl get deploy -n envoy-gateway-system -o wide
```

Controller und Overlay sind bewusst zwei Applys: eine CRD und ihre erste
Instanz im selben Apply wären ein Timing-Rennen. Aus demselben Grund gehört
der Controller nicht ins Overlay — `k8s:delete` würde sonst die
Gateway-API-CRDs und damit jedes `Gateway` und jede `HTTPRoute` mitreißen.

Alle `kubectl`-Skripte sind auf `--context kind-hfts` festgenagelt, damit ein
aktiver GKE-Kontext das lokale Overlay nicht in die Cloud schiebt.

```bash
kubectl kustomize k8s/overlays/local      # rendern, nichts anwenden
```

## Erreichen

```bash
kubectl port-forward svc/api 10002:10002  # muss laufen bleiben
curl -s localhost:10002/health
curl -s localhost:10002/api/tickets/00000000-0000-4000-8000-000000000000/availability
```

- Der Forward ist kein Daemon: endet der Prozess, ist der Tunnel weg.
  Zweites Terminal oder `&`.
- `Couldn't connect after 0 ms` = kein Forward aktiv, nicht die API.
- Event-Id ist `MAIN_SALE_EVENT_ID` aus `packages/types/src/tickets.ts`.
- `/health` zuerst: trennt kaputten Tunnel von falscher Route.

## Diagnose

```bash
kubectl describe pod -l app=api           # Events am Ende
kubectl logs -l app=api --tail=50
kubectl logs <pod> --previous             # bei CrashLoopBackOff der wichtigste Schalter
kubectl get endpoints api                 # <none> = Selector trifft nicht
kubectl exec <pod> -- env | sort          # kam die ConfigMap an?
kubectl get events --sort-by=.lastTimestamp
kubectl rollout restart deploy/api        # zieht KEIN neues Image
kubectl delete -k k8s/overlays/local
```

## Fallen

- `ErrImagePull` — `kind load` vergessen oder Tag vertippt. Nach jedem Rebuild neu laden.
- `CreateContainerConfigError` — ConfigMap/Secret-Name in `envFrom` existiert nicht.
- `Service` braucht `apiVersion: v1`, nicht `apps/v1`.
- Leere Datei in `resources` wird stillschweigend übersprungen.
- Zod `Required` beim Boot — Variable fehlt oder ist leer.
- `localhost` in einer Adresse — im Pod ist das der Pod, nicht der Mac.
- `port-forward service/<name>` scheitert bei Service ohne Selector.
- Worker ohne Topic beendet sich mit exit 1 (ADR-044) → `CrashLoopBackOff`.

## Compose-Host-Ports

| Dienst   | im Compose-Netz | vom Cluster aus              |
| -------- | --------------- | ---------------------------- |
| Redis    | `redis:6379`    | `host.docker.internal:10004` |
| Pub/Sub  | `pubsub:8085`   | `host.docker.internal:10005` |
| Postgres | `postgres:5432` | `host.docker.internal:10006` |
