# ADR-043: Web ist konfigurationsfrei

- Status: Fertig
- Datum: 2026-09-08

## Kontext

`apps/web` bezog zwei Werte aus dem Env-Profil: `VITE_API_URL` und
`VITE_EVENT_ID`. Vite ersetzt `import.meta.env.VITE_*` beim Build statisch —
laut Vite-Doku „statically replaced at build time to make tree-shaking
effective". Daraus folgte:

- `vite build` verlangte `HTS_ENV_PROFILE`, das Web-Dockerfile also ein `ARG`.
- Die API-Adresse klebte im Bundle. In GKE steht der Ingress-Hostname zum
  Build-Zeitpunkt nicht fest; `cloud-dev.env` und `cloud-capacity.env` trugen
  deshalb `http://replace-me.invalid` — einen Wert, der nie auflösbar war.
- Dasselbe Artefakt konnte nicht durch Stages promoted werden.

Die Werte hielten der Prüfung als Konfiguration nicht stand. `VITE_EVENT_ID`
war in **allen** Profilen dieselbe UUID und stand zusätzlich hartkodiert in
`scripts/local/lib/stack-steps.mjs` — eine Konstante, die wie Konfiguration
aussah. `VITE_API_URL` hatte genau zwei Werte: die lokale Adresse und den
Platzhalter.

## Entscheidung

`apps/web` hat keine Env-Variablen. Beide Werte verschwinden auf
unterschiedlichen Wegen.

**API-Adresse: same origin.** Das Frontend kennt sie nicht, sondern ruft
`/api/...` relativ auf (`apps/web/src/lib/api.ts`). Den gemeinsamen Origin
stellt ein Reverse Proxy her: nginx im Container, der Ingress in GKE, und
lokal `server.proxy`/`preview.proxy` in `apps/web/vite.config.ts`. Das
Proxy-Ziel dort ist ein Literal (`http://localhost:10002`) — der Port-Block
10001–10009 ist im Repo fix vergeben, und ein Dev-Proxy-Ziel ist keine
Deployment-Konfiguration. Es aus einem Profil zu lesen würde eine neue
Env-Variable einführen und damit das Ziel verfehlen.

**Event-Id: Konstante.** `MAIN_SALE_EVENT_ID` in `@repo/types/tickets`.

Das Env-Modul des Frontends (zuvor `src/lib/env.ts`) entfällt, `clientPrefix: "VITE_"` in `@repo/env`
bleibt ungenutzt stehen, und die Frontend-Prüfung in
`scripts/debug/check-env-profiles.mjs` fällt weg.

## Begründung

Konfiguration ist, was sich zwischen Umgebungen unterscheidet. Nach diesem
Maßstab war keiner der beiden Werte Konfiguration — der eine war überall
gleich, der andere in der Cloud unbekannt und deshalb ein Platzhalter. Sie als
Env-Variablen zu führen erzwang eine Kopplung des Builds an eine Umgebung,
ohne dafür etwas zu leisten.

Same origin löst zusätzlich CORS auf und macht Dev, Preview und Produktion
verhaltensgleich: alle drei sprechen die API unter demselben Origin an.

## Alternativen

- **Runtime-Config über `/config.js`** (globales Objekt, vom Container-Entrypoint
  geschrieben): das verbreitete Muster für echte, pro Umgebung verschiedene
  Adressen. Hier überdimensioniert — es hätte Entrypoint-Skript, Cache-Regeln
  und eine zweite Quelle für dieselbe Form eingeführt, um zwei Werte
  auszuliefern, die keine Konfiguration sind. Vite dokumentiert für statische
  Builds ohnehin keinen Runtime-Mechanismus.
- **`ARG HTS_ENV_PROFILE` im Dockerfile:** kleinster Eingriff, hält aber genau
  die Kopplung fest, die weg soll — ein Image pro Umgebung.
- **`GET /api/events/current`:** der saubere Weg, sobald es mehr als einen Sale
  gibt. Heute suggeriert der Endpunkt eine Flexibilität, die das System nicht
  hat, und kostet einen Roundtrip plus Ladezustand vor dem ersten Render.

## Konsequenzen

- `vite build` braucht kein Profil und ist über Profile hinweg Turbo-cachebar.
  Das Web-Dockerfile braucht kein `ARG`, dasselbe Image läuft überall.
- `pnpm --filter web run dev` und `run preview` brauchen ebenfalls kein Profil
  mehr. Das widerspricht ADR-034 nicht: es gibt in `apps/web` nichts zu
  konfigurieren.
- **Ein Reverse Proxy vor Web und API ist ab jetzt Voraussetzung, nicht
  Komfort.** Ohne `location /api/` in der nginx-Config bzw. eine
  entsprechende Ingress-Regel läuft das Frontend im Container ins Leere.
- `MAIN_SALE_EVENT_ID` ist in `scripts/local/lib/stack-steps.mjs` weiterhin als
  Literal doppelt geführt. Root-Skripte sind plain Node ohne
  `@repo/*`-Abhängigkeit; die Konstante dort zu importieren würde eine
  Root-Dependency und einen Build-Schritt vor `pnpm seed` verlangen. Der
  Kommentar an der Konstante nennt beide Stellen.
- Sobald ein zweiter Sale dazukommt, ist `MAIN_SALE_EVENT_ID` keine Konstante
  mehr: dann gehört die Id in die Route oder hinter einen API-Endpunkt.
