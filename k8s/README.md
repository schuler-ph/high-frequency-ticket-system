# Kubernetes-Manifeste

Lokal kind ([ADR-038](../docs/decisions/ADR-038-kind-als-lokaler-kubernetes-cluster.md)),
später GKE. Datenstores bleiben in `docker-compose.yml`, erreichbar über
`host.docker.internal`.

## Aufbau

| Pfad              | Inhalt                                                     |
| ----------------- | ---------------------------------------------------------- |
| `base/`           | Deployments, Services, Probes, Ressourcen — überall gleich |
| `overlays/local/` | kind: Compose-Adressen, lokales Secret, 1 Replica          |
| `overlays/cloud/` | GKE: Cloud-Adressen, Cluster-Secret, Replica-Zahl          |

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
kind load docker-image hfts-api:dev --name hfts        # analog worker, web
kubectl kustomize k8s/overlays/local      # rendern, nichts anwenden
kubectl apply -k k8s/overlays/local
kubectl get pods -w                       # beide 1/1 Running
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
