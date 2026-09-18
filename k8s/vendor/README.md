# k8s/vendor

Fremde Cluster-Ausstattung als heruntergeladene Manifeste. Nichts hier ist
eigener Code, und nichts außer dieser Datei und `.gitignore` wird versioniert.

## Warum nicht im Repository

`install.yaml` ist rund 4 MB und 63.000 Zeilen. Versioniert würde sie jeden
Diff unlesbar machen, ohne dass sich je eine Zeile davon durch eigene Arbeit
ändert. Nachvollziehbar bleibt der Stand trotzdem: die Version steht in
`package.json`, und die Prüfsumme unten belegt, welcher Stand hier lag.

## Was hier liegt

| Datei          | Herkunft                                           | Inhalt                                                                                     |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `install.yaml` | Envoy-Gateway-Release v1.9.1, Asset `install.yaml` | Gateway-API-CRDs, Namespace `envoy-gateway-system`, Deployment und Service des Controllers |

SHA-256 des Stands v1.9.1:

```
72b3971364f172eb0b9636c7142cc84ff695467bc065897958bde85a3c06cfd5
```

## Holen und anwenden

```bash
pnpm gateway:fetch     # lädt install.yaml, wenn sie fehlt
pnpm gateway:install   # applied sie gegen kind-hfts und wartet auf den Controller
```

`gateway:fetch` lädt nur bei fehlender Datei.

## Versionswechsel

Die Version steht an **zwei** Stellen in `package.json`: in der URL von
`gateway:fetch` und im Image-Tag von `kind:load`. Beide gehören geändert, dazu
die alte `install.yaml` gelöscht und das neue Image gepullt.

Wird nur eine Stelle geändert, bricht nichts — der Node behält wegen
`imagePullPolicy: IfNotPresent` das alte Image und der Controller läuft in der
falschen Version weiter. Deshalb bei einem Wechsel prüfen:

```bash
kubectl --context kind-hfts get deploy -n envoy-gateway-system envoy-gateway \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

## Bewusst nicht hier

- `envoy-gateway-crds.yaml` — reine Teilmenge von `install.yaml`. Sinnvoll nur,
  wenn CRDs und Controller in zwei getrennten Applys laufen müssen. Tun sie
  nicht: `gateway:install` und `k8s:apply` sind bereits zwei Schritte.
- `quickstart.yaml` — Beispiel-App samt eigener GatewayClass, Gateway und
  HTTPRoute. Diese drei Objekte sind eigene Arbeit und liegen in `k8s/`.

## Gilt nur lokal

In GKE bringt Google Controller und GatewayClass mit. Dieses Verzeichnis ist
kind-Ausstattung und hat in der Cloud kein Gegenstück.
