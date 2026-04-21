# Proposal: Runtime Packaging fuer Shared Workspace-Pakete

## Problem

Die gebauten Backend-Services (`apps/api`, `apps/worker`) starten aus `dist`, importieren aber zur Laufzeit weiterhin `@repo/env` und `@repo/types`, die aktuell nur TypeScript-Source exportieren.

Dadurch ist der lokale Testpfad zwar sauber, der Plain-Node-Runtime-Pfad fuer gebaute Artefakte aber nicht konsistent ueber alle Shared-Pakete hinweg.

## Zielbild

Alle Shared-Pakete, die von gebauten Backend-Artefakten zur Laufzeit importiert werden, folgen demselben Export-Muster:

- `types`: zeigt auf die TypeScript-Quelle fuer Editor und Typechecking
- `source`: zeigt auf die TypeScript-Quelle fuer `node --conditions=source` in Tests und Dev-Pfaden
- `default`: zeigt auf das gebaute JavaScript in `dist`

`@repo/db` ist dafuer bereits das Referenzmuster.

## So sollte es aussehen

### 1. `@repo/env` und `@repo/types` werden buildbare Runtime-Pakete

- beide Pakete erhalten ein `build`-Skript ueber `tsgo`
- beide Pakete emitten JavaScript nach `dist`
- beide Pakete bekommen `exports` mit `types`/`source`/`default`

Beispiel fuer `@repo/env`:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "source": "./src/index.ts",
      "default": "./dist/src/index.js"
    }
  },
  "scripts": {
    "build": "tsgo",
    "check-types": "tsgo --noEmit",
    "lint": "eslint . --max-warnings 0"
  }
}
```

Beispiel fuer `@repo/types`:

```json
{
  "type": "module",
  "exports": {
    "./tickets": {
      "types": "./src/tickets.ts",
      "source": "./src/tickets.ts",
      "default": "./dist/src/tickets.js"
    },
    "./errors": {
      "types": "./src/errors.ts",
      "source": "./src/errors.ts",
      "default": "./dist/src/errors.js"
    }
  }
}
```

### 2. Backend-Builds nutzen Default-Exports, Tests weiter `source`

- `pnpm --filter api run build` und `pnpm --filter worker run build` sollen nur gegen gebaute JS-Artefakte startbar sein
- paketlokale Tests bleiben unveraendert auf `node --conditions=source --test`
- dadurch gibt es keine Dist-Abhaengigkeit im lokalen Test-Hot-Path, aber einen konsistenten Startpfad fuer gebaute Services

### 3. Turbo-Build-Graph wird explizit gemacht

- `api` und `worker` sollten beim Build auf die Runtime-Pakete zeigen, die sie zur Laufzeit brauchen
- mindestens `@repo/env`, `@repo/types` und fuer den Worker weiter `@repo/db`

Ziel ist nicht, Tests an Builds zu koppeln, sondern nur den Build-/Startpfad korrekt zu verdrahten.

### 4. Keine Sonderbehandlung fuer Tests wieder einfuehren

Der Proposal aendert nichts am stabilen Testmodell:

- kein Shared Runner
- kein `tsx` im Backend-Test-Hot-Path
- keine Dist-Pflicht fuer `pnpm test`

## Empfohlene Umsetzung in kleinen Schritten

1. `@repo/env` buildbar machen und duale Exports einfuehren.
2. `@repo/types` buildbar machen und duale Exports einfuehren.
3. `api`-Build gegen gebaute Workspace-Pakete validieren.
4. `worker`-Build gegen gebaute Workspace-Pakete validieren.
5. Root- und CI-Build pruefen, ohne den lokalen Testpfad zu veraendern.

## Akzeptanzkriterien

- `pnpm --filter @repo/env run build` und `pnpm --filter @repo/types run build` erzeugen verwendbare `dist`-Artefakte
- `pnpm --filter api run build && pnpm --filter api start` funktioniert ohne implizite `.ts`-Runtime-Abhaengigkeit aus Workspace-Paketen
- `pnpm --filter worker run build && pnpm --filter worker start` funktioniert unter denselben Bedingungen
- `pnpm test` bleibt schnell und weiterhin source-basiert
