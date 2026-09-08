# ADR-042: Turbo ist der einzige Build-Einstieg

- Status: Fertig
- Datum: 2026-09-08

## Kontext

`apps/api` und `apps/worker` bauten ihre Workspace-Abhängigkeiten selbst:

```json
"build": "pnpm --filter @repo/env run build && pnpm --filter @repo/types run build && pnpm --filter @repo/db run build && rm -rf dist && tsgo"
```

Damit existierten zwei Beschreibungen derselben Abhängigkeit — die Kette im
Skript und `build.dependsOn: ["^build"]` in `turbo.json`. Beide gerieten
auseinander: `apps/web` hatte keine Kette, obwohl es `@repo/env` und
`@repo/types` gebaut braucht, und die Kette des Workers nannte `@repo/db`,
während die der API es weglässt.

Praktische Folgen: In den Container-Builds lief jedes Paket doppelt (einmal von
Turbo, einmal von der Kette), ohne Cache-Nutzen. Und wer die Kette pflegte,
musste bei jeder neuen Abhängigkeit an zwei Stellen denken.

Der Grund für die Ketten war real: nicht jeder Einstieg läuft über Turbo.
`fastify start` lädt `dist/app.js`, `drizzle-kit` lädt `drizzle.config.ts` —
beide setzen die `source`-Condition nicht und lösen Workspace-Pakete deshalb
über `default` nach `dist/` auf. Ohne gebautes `dist/` scheitern sie.

## Entscheidung

Die Abhängigkeitsreihenfolge steht nur noch in `turbo.json`. Package-`build`
-Skripte bauen ausschließlich ihr eigenes Paket:

```json
"build": "rm -rf dist && tsgo"
```

Jeder Einstieg, der gebaute Workspace-Pakete konsumiert, ruft Turbo davor auf
statt eine eigene Kette zu führen:

- `apps/{api,worker}` `start` und `start:loadtest`: `turbo run build --filter=<app> && fastify start …`
- VS-Code-Task `api:build`: `pnpm exec turbo run build --filter=api`
- CI vor `db:migrate`: `pnpm exec turbo run build --filter=@repo/env`
- Dockerfiles: `pnpm exec turbo run build --filter=<app>` (unverändert)

Turbo liegt als Root-Devdependency vor und ist in Package-Skripten über den
Workspace-Root-`.bin` auf dem PATH; ein `pnpm exec` ist dort nicht nötig.

## Begründung

Eine Abhängigkeit, eine Quelle. Turbo kennt den Graphen ohnehin aus den
`package.json`-Deps, die Ketten wiederholten ihn nur fehleranfällig. Zusätzlich
greift jetzt der Turbo-Cache auch bei `start:loadtest`, wo vorher jedes Paket
unbedingt neu gebaut wurde.

Tests brauchen diesen Weg nicht: sie laufen mit `--conditions=source` direkt
gegen `src/` und sind vom `dist/`-Zustand unabhängig.

## Alternativen

- **Ketten überall konsistent nachziehen** (auch in `web`): löst das
  Auseinanderlaufen nicht, sondern verdoppelt die Pflegestelle dauerhaft.
- **`prestart`-Hooks statt expliziter Aufrufe:** versteckt den Build-Schritt.
  Ein `start`, das sichtbar `turbo run build` aufruft, ist im Runbook zitierbar.
- **Alles über `pnpm run build` im Root:** baut auch `web` mit, wenn nur der
  Worker gebraucht wird.

## Konsequenzen

- Wer ein Skript ergänzt, das `dist/` eines Workspace-Pakets lädt, muss
  `turbo run build --filter=…` davorsetzen. Die bekannten Fälle sind
  `fastify start`, `drizzle-kit` und `vite` (Node-Seite der Config).
- `turbo run build` darf nicht aus einem Skript aufgerufen werden, das selbst
  ein Turbo-Task ist — das wäre ein rekursiver Aufruf. Betrifft aktuell keinen
  Fall: `start` und `start:loadtest` stehen nicht in `turbo.json`.
- Die Turbo-Version in den Dockerfiles ist auf die Repo-Version gepinnt
  (`turbo@2.8.11`), weil `turbo prune` das Layout der folgenden Build-Stages
  bestimmt.
