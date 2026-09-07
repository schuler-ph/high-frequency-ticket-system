# ADR-040: Cloud-Profile — Zugangsdaten kommen aus dem Prozess-Env, das Profil bleibt eine Datei

- **Status:** Umgesetzt; Entscheidung 1 abgelöst durch ADR-041
- **Datum:** 2026-09-06
- **Kontext:** ADR-034 hat die Konfiguration auf genau eine Quelle gezogen: ein
  Profil ist eine eingecheckte, vollständige Datei unter `config/env/`, kein
  Wert hat einen Default, und `pnpm run debug:env` verlangt jede
  Schema-Variable in jedem Profil. Punkt 4 begründet das Einchecken damit,
  dass die Werte lokale Container-Zugangsdaten sind — und klammert
  Secret-Handling für ein Cloud-Profil ausdrücklich aus. Phase 5 löst das ein:
  API und Worker laufen als Container (kind, dann GKE), `DATABASE_URL` und
  `REDIS_URL` tragen dort echte Zugangsdaten (REQ-D06: nie im Repository), und
  der Loader löst `config/env/` modul-relativ auf (`../../../config/env/` von
  `packages/env/dist/` aus) — ein Image, das nur `dist/` enthält, startet
  nicht. Dazu kommt: die Service-Werte eines ruhigen Deployments sind nicht
  die eines Messlaufs. Sechs Schema-Variablen wechseln zwischen `dev` und
  `browse-and-buy-full-speed` (`DATABASE_POOL_MAX` 20→50,
  `DISABLE_REQUEST_LOGGING`, `LOG_LEVEL`, `NODE_ENV`,
  `CHECKOUT_PENDING_TIMEOUT_SECONDS` 900→60,
  `WORKER_RESERVATION_REAPER_BATCH_SIZE` 1.000→10.000). Das ist Absicht —
  ADR-034 bindet Lastform und Service-Abstimmung in eine Datei — und muss in
  der Cloud umschaltbar bleiben.
- **Entscheidung:**
  1. **Das ganze `config/env/` liegt im Image**, an derselben relativen Tiefe
     wie im Repo. `turbo prune` kopiert es nicht (es ist kein
     Workspace-Paket); das Dockerfile kopiert es ausdrücklich. Damit bleibt
     `HTS_ENV_PROFILE` ein Laufzeit-Schalter wie lokal: Profilwechsel ist eine
     Env-Variable im Manifest, kein Rebuild.
  2. **Zugangsdaten stehen in keiner Datei.** Im Cloud-Profil stehen
     `REDIS_URL=` und `DATABASE_URL=` als **leere Zuweisung**. Der Key ist
     vorhanden (der Guard ist erfüllt), der Wert kommt aus dem
     Kubernetes-Secret. Das funktioniert ohne Code-Änderung: `override: false`
     lässt bereits gesetztes Prozess-Env gewinnen, und
     `emptyStringAsUndefined: true` macht die leere Zuweisung zu `undefined`,
     sodass Zod bei fehlendem Secret „Required" für die benannte Variable
     meldet — Fail-Fast bleibt erhalten. Die leere Zuweisung ist die sichtbare
     Form von „wird injiziert", kein impliziter Default.
  3. **Zwei Cloud-Profile.** `cloud-dev` für Smoke-Test und Debugging (kleiner
     Pool, sichtbares Logging, Seed 1.000) und `cloud-capacity` für den
     50k-Lauf (die sechs Tuning-Werte aus `browse-and-buy-full-speed`, Seed
     1 M). Die lokalen Profile bleiben unberührt.
  4. **`PUBSUB_EMULATOR_HOST` wird im Schema optional** und steht in den
     Cloud-Profilen leer. Die Client-Library liest die Variable selbst aus dem
     Prozess-Env; der Code übergibt sie nicht.
  5. **Adressen, die erst `terraform apply` kennt** (externe Gateway-IP,
     interner Prometheus-LoadBalancer), stehen als `replace-me.invalid`
     (RFC 2606, löst nie auf): ein Platzhalter, der laut scheitert statt
     plausibel auszusehen. Empfohlen: die externe IP in Terraform reservieren,
     dann ist sie vor dem Deploy bekannt.
  6. **Der k6-Block kommt erst in Phase 5.7** in `cloud-capacity`, wenn
     Cluster und Generator-VM existieren und die Werte messbar statt geraten
     sind. Er wird von API und Worker nicht gelesen (Zod ignoriert unbekannte
     Keys), sondern auf der VM per `source`. Es gibt keinen Orchestrierungs-
     oder Belegerhebungs-Block: der Cloud-Lauf startet k6 direkt, die Evidenz
     sind Grafana-Panels über das Lauffenster.
- **Begründung:**
  - **Kein neuer Mechanismus.** Loader, Schema-Optionen und Guard bleiben, wie
    sie sind. Die Entscheidung ist eine Datenorganisation, kein Code — genau
    die Klasse Änderung, die am wenigsten kaputtgehen kann.
  - **ADR-034 bleibt wörtlich wahr.** Es gibt weiterhin genau eine Datei pro
    Profil, und sie deklariert jeden nicht-geheimen Wert explizit. Ausgelassen
    ist nichts; zwei Werte sind sichtbar nach außen verlagert.
  - **REQ-D06 erfüllt sich von selbst.** Zugangsdaten stehen nie in einer
    Datei, die committet wird — weder lokal noch in der Cloud.
  - **Fail-Fast bleibt.** Ein vergessenes Secret ist ein Zod-Fehler mit
    Variablennamen beim Boot, kein Timeout Minuten später.
- **Alternativen (verworfen):**
  - **Sentinel-Profil (`HTS_ENV_PROFILE=env`, alles aus dem Prozess-Env):**
    braucht eine neue Fallunterscheidung im Loader — genau die Art Ausnahme,
    die ADR-034 abgeschafft hat — und liefert dieselbe Sicherheit wie die
    leere Zuweisung, nur mit mehr Code.
  - **Die ganze Profil-Datei als ConfigMap mounten:** die Zugangsdaten landen
    zwangsläufig in der ConfigMap, also im Ressourcentyp, der per Konvention
    keine Geheimnisse trägt. Zusätzlich koppelt der Mount-Pfad das Manifest
    hart an die Tiefe von `dist/` relativ zu `config/`.
  - **Platzhalter-Werte für Zugangsdaten** (`redis://set-by-secret`): ein
    syntaktisch gültiger Wert passiert Zod und scheitert erst als
    Verbindungsfehler — das verliert Fail-Fast und ist genau der plausibel
    aussehende implizite Default, gegen den ADR-034 steht.
  - **Ein Cloud-Profil, Tuning per Env-Override:** die sechs Tuning-Werte
    würden pro Deployment im Manifest überschrieben — eine zweite Wahrheit
    neben der Datei, die ADR-034 beseitigt hat.
- **Konsequenzen:**
  - Dockerfiles (API, Worker) kopieren `config/env/` ausdrücklich; die
    Manifeste setzen `HTS_ENV_PROFILE` per ConfigMap und `REDIS_URL` /
    `DATABASE_URL` per `secretKeyRef`.
  - `pnpm run debug:env` bleibt unverändert. `cloud-capacity` steht bewusst
    nicht in `LOADTEST_PROFILES`: es trägt keinen Belegerhebungs-Block, und
    die Liste schrumpft mit dem Rückbau der Messkette (Phase 5.7).
  - Für kind (Phase 5.1/5.2) folgt ein `kind`-Profil nach demselben Muster:
    Zugangsdaten leer, Emulator über `host.docker.internal:10005`.
  - ADR-034 Punkt 4 ist per Nachtrag präzisiert. Die Schema-Änderung für
    `PUBSUB_EMULATOR_HOST` ist umgesetzt (`check-types`, `test` und ein
    Profil-Start ohne die Variable sind grün). Offen und deshalb „Teilweise
    umgesetzt": die Dockerfile-Zeile für `config/env/` und die Manifeste.

## Nachtrag 2026-09-07: Entscheidung 1 ist durch ADR-041 abgelöst

Entscheidung 1 löste das Transportproblem, indem das Dockerfile `config/env/`
ausdrücklich ins Image kopiert — an derselben relativen Tiefe wie im Repo,
weil der Loader modul-relativ auflöst. Genau diese Kopplung an eine
Verzeichnistiefe ist unter „Alternativen" als Preis benannt.

[ADR-041](ADR-041-env-profile-liegen-im-paket-repo-env.md) beseitigt sie an
der Wurzel: die Profile liegen jetzt in `packages/env/profiles/` und damit in
dem Paket, das `pnpm deploy` ohnehin vollständig ins Image kopiert. Die
`COPY`-Zeile im Dockerfile entfällt ersatzlos — sie war das letzte offene
Stück dieses ADRs und wird nun nicht mehr gebraucht.

Entscheidungen 2 bis 4 gelten unverändert: Zugangsdaten bleiben leere
Zuweisungen aus dem Kubernetes-Secret, es bleibt bei zwei Cloud-Profilen, und
`HTS_ENV_PROFILE` bleibt ein Laufzeit-Schalter ohne Rebuild.
