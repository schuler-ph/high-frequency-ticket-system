# ADR-034: Ein Profil ist eine Datei — keine impliziten Defaults

- **Status:** Fertig
- **Datum:** 2026-08-16
- **Kontext:** Die Konfiguration hatte vier parallele Quellen, und keine war
  vollständig.
  1. Das Zod-Schema in `packages/env/src/index.ts` — 17 Variablen, 9 davon mit
     `.default(...)`, genau die Tuning-Knöpfe, die im Lasttest interessant sind.
  2. Eigene Literal-Defaults in `scripts/local/reset.mjs`,
     `scripts/local/bench-hot-row.mjs` und `packages/db/scripts/*.ts` —
     `DATABASE_URL` gleich dreifach.
  3. Inline gesetzte Werte in `apps/{api,worker}/package.json`, die faktischen
     Lasttest-Profile, verteilt über zwei Dateien.
  4. Eine Profil-Tabelle im k6-Skript plus eine Doku-Tabelle in
     `load-tests/README.md`.

  Die Folgen waren messbar, nicht theoretisch. `SALE_OPENS_IN_SECONDS`
  defaultete im Seed-Skript auf `0` und im Report-Orchestrator auf `60`.
  `WORKER_INVENTORY_CYCLE_INTERVAL_SECONDS` fehlte in `.env.test` und lebte
  ausschließlich vom Zod-Default — niemand hätte es bemerkt, bis der Default
  fällt. Und der VS-Code-Task `loadtest:api` rief `start:loadtest` statt
  `start:loadtest:funnel`, sodass ein über den Button gestarteter Funnel-Lauf
  die Services mit den falschen Werten hochfuhr.

  Der gemeinsame Nenner: ein Default ist eine Entscheidung, die niemand trifft
  und die niemand sieht. Bei einem System, dessen Zweck der Nachweis von
  Kapazität und Korrektheit unter Last ist, ist eine unsichtbare Konfiguration
  ein Messfehler.

- **Entscheidung:**
  1. **Keine Variable hat einen Default.** Weder im Zod-Schema, noch als
     `??`-Fallback in den Node-Skripten, noch als `||`-Fallback im k6-Skript.
     Fehlt ein Wert, bricht der Prozess mit einer Meldung ab, die die Variable
     benennt.
  2. **Ein Profil ist genau eine Datei** unter `config/env/<profil>.env`. Die
     Datei ist vollständig: was dort nicht steht, gilt nicht. Profile erben
     nicht voneinander — Vererbung wäre kürzer und würde genau die Frage
     „welcher Wert galt im Lauf?" wieder öffnen.
  3. **`HTS_ENV_PROFILE` wählt das Profil** und hat selbst keinen Default.
     Einzige Ausnahme: die Test-Skripte setzen `${HTS_ENV_PROFILE:-test}`, damit
     `pnpm test` ohne Zeremonie läuft; CI überschreibt mit `ci`. Das ist eine
     Aussage über die _Auswahl_, nicht über einen _Wert_ — jeder Wert bleibt
     explizit.
  4. **Die Dateien sind eingecheckt.** Die Werte sind lokale
     Container-Zugangsdaten (`postgres/postgres`, Emulator-Ports), keine
     Geheimnisse. Nur so kann CI ein Profil laden, ohne dass jemand acht
     Variablen im Job-Env pflegt, und nur so ist nach einem `git clone` ohne
     weiteren Schritt etwas startbar.
  5. **Der Loader löst modul-relativ auf.** Der frühere Aufruf
     `config({ path: ["../../.env"] })` war cwd-relativ und funktionierte nur
     aus `apps/*`/`packages/*`; aus dem Repo-Root zeigte er aus dem Repository
     heraus. Damit entfällt auch `@repo/env/test-bootstrap` als eigener
     Mechanismus.
  6. **Ein Guardrail prüft Vollständigkeit.** `pnpm run debug:env` verlangt jede
     Schema-Variable in jedem Profil und jede Lasttest-Variable in jedem
     Lasttest-Profil. Ohne diese Prüfung wäre die Lücke aus dem Kontext-Absatz
     nur eine Frage der Zeit, weil sieben Dateien auseinanderlaufen.

- **Begründung:**
  - Ein Default beantwortet die Frage „was gilt hier?" an der falschen Stelle:
    im Code, statt in der Konfiguration des konkreten Laufs. Für Dev-Komfort ist
    das ein guter Tausch, für einen Messaufbau nicht.
  - Duplikation zwischen sieben Profil-Dateien ist der bewusst gezahlte Preis.
    Sie ist sichtbar und maschinell prüfbar; die vorherige Verteilung über
    Schema, Skripte, package.json und k6-Tabelle war weder das eine noch das
    andere.
  - Der Report gewinnt: `HTS_ENV_PROFILE` steht im Manifest, und damit ist die
    Frage „mit welcher Konfiguration lief das?" mit einem Wort beantwortet
    statt mit zwanzig.

- **Alternativen (verworfen):**
  - **Defaults behalten, nur die Profile einführen:** löst die Verteilung, nicht
    die Unsichtbarkeit. Ein unvollständiges Profil würde still auf Defaults
    zurückfallen — genau der Fehler, der `WORKER_INVENTORY_CYCLE_INTERVAL_SECONDS`
    verdeckt hat.
  - **Ein Basis-Profil, das die anderen erweitern:** weniger Duplikation, aber
    ein Lasttest-Profil wäre dann nicht mehr an einer Stelle lesbar.
  - **Profile gitignored, nur `.env.example` eingecheckt:** maximale Trennung,
    aber CI und frische Worktrees bräuchten einen Erzeugungsschritt. Bei
    Nicht-Geheimnissen ist das Zeremonie ohne Gegenwert.
  - **Werte aus `docker-compose.yml` ableiten:** würde die Duplikation von Ports
    und Zugangsdaten wirklich beseitigen, ist aber ein eigener Umbau — heute
    stehen sie an fünf Stellen.

- **Bewusst außerhalb des Scopes:** die fünffache Duplikation von Ports und
  Zugangsdaten zwischen `docker-compose.yml`, den Profilen, den Seed-Skripten
  und `packages/db/scripts/*`; Secret-Handling für ein späteres Cloud-Profil.

- **Umsetzungsplan:** drei Schritte — Profil-Dateien und Loader, dann die
  Profil-Menüs an den VS-Code-Buttons, zuletzt das Entfernen aller Defaults.

## Nachtrag 2026-08-16: umgesetzt

Alle drei Schritte sind gefahren. Acht Profile statt der geplanten sieben: das
Hot-Row-Werkzeug hat sieben eigene `BENCH_*`-Knöpfe bekommen, die in keinem
Lasttest-Profil etwas zu suchen hätten, und deshalb ein eigenes `bench`-Profil.

Zwei Dinge sind beim Umsetzen dazugekommen. Die Profil-Tabelle im k6-Skript ist
ersatzlos entfallen — sie war eine zweite Wahrheit neben der Profil-Datei und
konnte von den Service-Werten abweichen. Und `THINK_TIME_KIND` (`none` /
`uniform` / `normal`) ist neu: ohne Tabelle braucht die Denkzeitverteilung einen
eigenen expliziten Wert, statt aus der An- oder Abwesenheit eines
Objekt-Eintrags zu folgen.

## Nachtrag 2026-08-25: die Lastform ist Teil des Profils

Die k6-Phasen-Skripte trugen die letzten hartkodierten Werte, die eine Messung
prägen: `maxVUs: 10000`, die Stage-Targets und die Cool-down-Rate. Baseline E
hat gezeigt, warum das nicht reicht — alle drei Profile brauchten eine andere
Generator-Größe, und die Dropped-Rate eines Laufs ist ohne den VU-Deckel im
Manifest nicht interpretierbar. Seit Phase 4.13 sind `K6_TARGET_RATE`,
`K6_MAX_VUS`, `K6_COOLDOWN_RATE` und `K6_COOLDOWN_MAX_VUS` Pflichtwerte jedes
Lasttest-Profils (`requireEnvNumber`, kein Skript-Default), fahren beim
Split-Lauf als `-e`-Flags mit und stehen im Report-Manifest. Ein verteilter
Generator (Phase 5.7) teilt die Zielrate über Shards auf — genau das war mit
Skript-Konstanten unmöglich.

## Nachtrag 2026-08-25: das Frontend liest das Profil

Eine Lücke war offen geblieben: `apps/web` importiert `@repo/env` nicht, und
Next.js lädt `.env*`-Dateien nur aus dem eigenen Verzeichnis. Die
`NEXT_PUBLIC_*`-Zeilen in den Profilen erreichten den Browser deshalb nie —
tatsächlich kamen `NEXT_PUBLIC_API_URL` und `NEXT_PUBLIC_EVENT_ID` aus einer
gitignorierten `apps/web/.env.local`, einer zweiten Wahrheit, die niemand
prüfte. Jetzt laden `dev`, `start` und `build` des Web-Pakets die
`NEXT_PUBLIC_*`-Werte des Profils über
`scripts/lib/run-with-profile.mjs --prefix=NEXT_PUBLIC_` ins Prozess-Env —
nicht per `--env-file` wie die Root-Skripte, weil Next.js seine `execArgv` an
Worker-Threads weiterreicht und Node `--env-file` dort ablehnt
(`ERR_WORKER_INVALID_EXEC_ARGV`), und nur das Präfix, weil `next build` mit dem
`NODE_ENV` eines Profils bricht und der Rest im Frontend-Prozess nichts verloren
hat;
`dev`/`start` verlangen das Profil über denselben Guard, `build` fällt auf `dev`
zurück — dieselbe Klasse Ausnahme wie `${HTS_ENV_PROFILE:-test}` in den
Test-Skripten: eine Aussage über die Auswahl, nicht über einen Wert, denn die
Frontend-Werte sind in allen Profilen identisch und `pnpm build` (CI, `verify:all`)
soll ohne Zeremonie laufen. `pnpm run debug:env` verlangt beide
Frontend-Variablen in jedem Profil. Eine vorhandene `.env.local` bleibt
wirkungslos, weil Next.js bereits gesetztes Prozess-Env nicht überschreibt.

## Nachtrag 2026-08-27: Präfix `VITE_` statt `NEXT_PUBLIC_`

Mit dem Wechsel des Frontends auf Vite (ADR-039) heißen die Frontend-Variablen
`VITE_API_URL` und `VITE_EVENT_ID`; `run-with-profile.mjs` läuft mit
`--prefix=VITE_`. Der Mechanismus bleibt: Vite liest `.env`-Dateien ebenfalls
nur aus dem eigenen Verzeichnis, das Profil in `config/env/` erreicht den
Build also weiterhin nur über das Prozess-Env, und ein fremdes `NODE_ENV` aus
dem Profil würde Vites Modus-Erkennung überschreiben — der Präfix-Filter ist
deshalb weiterhin nötig. `build` fällt unverändert auf `dev` zurück.

## Nachtrag 2026-09-06: Cloud-Profile und Zugangsdaten (ADR-040)

Punkt 4 galt für lokale Werte. Für Kubernetes und GKE präzisiert
[ADR-040](ADR-040-cloud-profile-geheimnisse-aus-dem-prozess-env.md): jedes
Profil bleibt eingecheckt und vollständig, Zugangsdaten stehen aber als leere
Zuweisung (`REDIS_URL=`) und kommen aus dem Kubernetes-Secret — `override:
false` und `emptyStringAsUndefined` machen das ohne Code-Änderung möglich, und
ein fehlendes Secret bleibt ein Zod-Fehler beim Boot. Das ganze `config/env/`
liegt im Image, damit `HTS_ENV_PROFILE` ein Laufzeit-Schalter bleibt. Neu sind
die Profile `cloud-dev` und `cloud-capacity`.
