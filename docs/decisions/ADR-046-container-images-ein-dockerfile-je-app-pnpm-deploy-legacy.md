# ADR-046: Container-Images — ein Dockerfile je App, `pnpm deploy --legacy`, kein Paketmanager zur Laufzeit

- **Status:** Umgesetzt für `api`, `worker` und `web`
- **Datum:** 2026-09-08, nachgetragen und auf den Stand von 2026-09-21 gebracht
- **Baut auf:** ADR-019 (Runtime-Pfad `dist`), ADR-040/ADR-041 (Profile und
  Zugangsdaten im Container), ADR-039 (Web ist eine Vite-SPA), ADR-045
  (Shutdown drainiert)
- **Kontext:** Phase 5.1 braucht je ein Image für `api`, `worker` und `web`.
  Bisher wurden nur fremde Images konsumiert; ein eigenes Image ist ein
  Artefakt, das ohne den Entwicklungsrechner funktionieren muss. Drei
  Eigenschaften dieses Monorepos machen das schwerer als ein
  Einzelpaket-Build:
  1. `workspace:*`-Abhängigkeiten sind lokal Symlinks in Nachbarverzeichnisse.
     Im Image existieren die Nachbarn nur, wenn man sie bewusst mitnimmt.
  2. pnpm legt `node_modules` **ohne Hoisting** an: `fastify` liegt nicht
     unter `/node_modules/fastify`, sondern als Symlink
     `apps/api/node_modules/fastify → ../../../node_modules/.pnpm/fastify@…`.
     Wer nur das Root-`node_modules` in ein Runtime-Image kopiert, bekommt
     `Cannot find module 'fastify'`.
  3. Die `start`-Skripte riefen vorher `pnpm run build` auf — im Container
     weder möglich noch gewollt (inzwischen durch ADR-042 aufgelöst).

  Der erste, bewusst naive Entwurf zeigte die typischen Fehlerklassen auf
  einmal: `turbo prune` in einem leeren Image, `COPY` aus dem Host-Kontext
  statt `--from=<stage>`, ein Runner ohne Inhalt, `RUN` statt `CMD`,
  `pnpm start` zur Laufzeit.

- **Entscheidung:**
  1. **Ein Dockerfile je App** unter `apps/<app>/Dockerfile`, mit dem
     **Repo-Root als Build-Kontext**. `turbo prune <app> --docker` läuft als
     eigene Stage **im Image**, nicht auf dem Host. Jeder Build ist damit
     isoliert; ein gemeinsames `out/`-Verzeichnis auf dem Host gibt es nicht.
  2. **Drei Stages: `pruner`, `builder`, `runner`.** Der Builder startet
     frisch von `node:24-alpine`, holt zuerst `out/json` (nur Manifeste und
     Lockfile) für `pnpm install --frozen-lockfile`, danach `out/full` für den
     Build. So bleibt der Install-Layer gecacht, solange sich keine
     `package.json` ändert. Installer und Builder werden **nicht** getrennt:
     Eine Stage, die per `FROM` alles vom Vorgänger erbt, ist keine Grenze,
     sondern nur ein Name. Stage-Grenzen gibt es genau dort, wo ein frisches
     `FROM` etwas zurücklässt.
  3. **Runtime-Layout über `pnpm --filter=<app> --prod --legacy deploy`.** Der
     Builder erzeugt damit ein eigenständiges Verzeichnis mit `dist/`,
     `package.json` und einem `node_modules`, dessen Symlinks alle **nach
     innen** in den eigenen `.pnpm`-Store zeigen. Der Runner kopiert nur
     dieses Verzeichnis. `--legacy` ist bewusst gewählt:
     `injectWorkspacePackages` bleibt **aus** (siehe Alternativen).
  4. **`files`-Felder benennen, was ein Paket ausliefert.** `apps/api`,
     `apps/worker`, `@repo/types` und `@repo/db` tragen `["dist"]`,
     `@repo/env` trägt `["dist", "profiles"]`. Der Deploy-Output enthält damit
     kein `src/`, kein `test/`, keine Editor- oder Lint-Konfiguration.
  5. **Kein Paketmanager im Runner.** Der Container startet
     `node --import @repo/env/preload node_modules/fastify-cli/cli.js start …`
     in Exec-Form und läuft als `node`, nicht als root. Das `--import` lädt das
     Env-Profil, **bevor** fastify-cli seine Argumente parst — nur so sieht die
     CLI `FASTIFY_CLOSE_GRACE_DELAY` aus dem Profil (ADR-045). `HFTS_ENV` und
     die Zugangsdaten kommen zur Laufzeit aus dem Prozess-Env (ADR-040).
  6. **Web bekommt keinen Node-Runner.** Pruner und Builder wie bei den
     Node-Apps, der Runner ist `nginxinc/nginx-unprivileged:alpine` mit dem
     `dist/` der Vite-SPA und einer eigenen `nginx.conf` (`try_files`, Port
     10001). Das mitgelieferte `10-listen-on-ipv6-by-default.sh` wird entfernt,
     damit der Container nicht gegen die eigene Server-Config arbeitet.
  7. **`.dockerignore` ist Pflicht.** Ausgeschlossen sind `node_modules`
     (auch verschachtelt), `.git`, `artifacts`, `out`, `**/dist`, `.turbo`,
     `.claude`, `tmp`, `output` und `packages/env/profiles/*.local.env`. Der
     Build-Kontext schrumpft damit von rund 500 MB auf 23 MB, und lokale
     Build-Reste oder gitignorierte Profile gelangen nicht ins Image.
  8. **Toolchain-Layer vor dem Code.** `npm i -g turbo@2.8.11` steht vor
     `COPY . .`, damit die Installation gecacht bleibt, wenn sich nur Code
     ändert; die Version ist gepinnt, damit der Build reproduzierbar ist. pnpm
     kommt in Build-Stages über `corepack enable` in der Version aus dem
     `packageManager`-Feld.

- **Begründung:**
  - **Prune im Image statt auf dem Host:** Der Host-Zustand (welches `out/`
    zuletzt erzeugt wurde) darf kein Bestandteil des Builds sein. API und
    Worker brauchen unterschiedliche Prune-Ergebnisse (`@repo/db` nur im
    Worker); im Image kollidiert nichts.
  - **`pnpm deploy` statt Kopieren von `node_modules`-Bäumen:** Das
    Symlink-Layout von pnpm lässt sich nur erhalten, wenn man **alle**
    `node_modules`-Ordner an denselben Pfaden kopiert — inklusive der
    devDependencies. `deploy` liefert genau die Prod-Abhängigkeiten in einem
    Ordner, den ein einziges `COPY --from` übernimmt.
  - **Kein pnpm zur Laufzeit:** `corepack enable` installiert nur einen Shim;
    die eigentliche pnpm-Binary würde beim ersten Aufruf **im Container**
    nachgeladen — als User `node` ohne Schreibrecht auf `/usr/local`, in
    Kubernetes womöglich ohne Egress. Außerdem wäre pnpm PID 1 und müsste
    SIGTERM an Fastify weiterreichen; `node` direkt als PID 1 macht das
    Signalverhalten zu einer Eigenschaft der Anwendung, nicht des Wrappers —
    die Voraussetzung dafür, dass ADR-045 im Cluster überhaupt greift.
  - **Stage-Grenzen nur mit frischem `FROM`:** Die Turborepo-Referenz legt
    Install und Build ebenfalls in eine Stage. Die Trennung hätte
    `docker build --target installer` als Debug-Komfort gebracht, aber weder
    Größe noch Cache verändert.

- **Alternativen (verworfen):**
  - **`injectWorkspacePackages: true`** (pnpm-10-Voraussetzung für `deploy`
    ohne `--legacy`): ersetzt die Workspace-Symlinks durch Kopien im Store.
    Änderungen in `packages/env` oder `packages/types` erreichen `api` und
    `worker` dann erst nach `pnpm install`; `pnpm dev` (`tsc-watch`) und die
    Tests mit `--conditions=source` verlieren die Live-Kopplung. pnpm nutzt
    Hardlinks, die In-Place-Edits meist durchreichen — bis ein Editor atomar
    speichert (schreiben, umbenennen) und den Link bricht. Eine globale
    Dev-Kosten-Entscheidung für einen Docker-Befehl ist die falsche Richtung.
    Injection löst Peer-Dependency-Konflikte, die dieses Repo nicht hat.
  - **Ein Dockerfile mit mehreren `--target`s** für alle Apps: technisch
    möglich, aber pro App ist ohnehin ein eigener Prune nötig, und eine Datei
    für drei unabhängige Images ist schwerer zu lesen als drei kurze.
  - **`turbo prune` auf dem Host, `out/` in den Kontext kopieren:** koppelt den
    Build an den Host-Zustand und kollidiert zwischen API und Worker.
  - **Das gesamte `/app` aus dem Builder in den Runner kopieren:** startet,
    trägt aber devDependencies, `src/`, `test/` und die Toolchain mit. Als
    Zwischenschritt legitim, nicht als Zielbild.
  - **`pnpm exec fastify start` als `CMD`:** siehe Begründung — Nachladen zur
    Laufzeit und pnpm als PID 1.
  - **`files: ["dist"]` auch für `@repo/env`:** würde `profiles/` aus dem
    Deploy werfen und den Container beim Boot mit „Profil existiert nicht"
    scheitern lassen (ADR-041). Deshalb `["dist", "profiles"]`.

- **Konsequenzen:**
  - Gemessen am API-Image (2026-09-08, arm64): 251 MB (davon rund 130 MB
    `node:24-alpine`), 244 Pakete im Store, Build 15 s mit warmem Cache,
    Build-Kontext 22,8 MB. `/app` enthält `dist`, `node_modules`,
    `package.json`, README — kein `src`, kein `test`.
  - Der lokale Dev-Loop ist unverändert: Symlinks, `tsc-watch`,
    `--conditions=source`.
  - Die Images tragen seit Phase 5.1/5.2 den lokalen Cluster: `kind load
docker-image` lädt sie, die Deployments referenzieren sie als
    `hfts-*:dev`. Gebaut werden sie über den Turbo-Task `docker:build`.
  - **Offen:** der Build für `linux/amd64` in CI samt Push. Er steht bewusst
    erst in Phase 5.4 (ADR-007) — vorher gibt es kein Push-Ziel, weil die
    Artifact Registry erst mit dem Cloud-Fundament entsteht.
  - `NODE_ENV=production` setzt bisher **kein** Dockerfile. Solange die Apps
    ihr Verhalten allein aus dem Env-Profil ableiten (ADR-040/041), fehlt
    nichts; wer sich auf Framework-Defaults verlässt, die an `NODE_ENV`
    hängen, muss es nachtragen.

- **Umsetzung:**
  - `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile`,
    `apps/web/nginx.conf`, `.dockerignore`
  - `package.json` (`docker:build` als Turbo-Task)
  - `apps/api/package.json`, `apps/worker/package.json`,
    `packages/types/package.json`, `packages/db/package.json`,
    `packages/env/package.json` (`files`)
