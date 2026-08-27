# ADR-039: Das Web-Frontend ist eine Vite-SPA, kein Next.js

- **Status:** Fertig
- **Datum:** 2026-08-27
- **Kontext:** `apps/web` entstand in Phase 0 als Next.js-App, weil das die
  erstbeste Wahl für „React + Tailwind im Turborepo" war — eine
  Server-Rendering-Anforderung gab es nie (REQUIREMENTS kennt keine). Vor der
  Containerisierung in Phase 5.1 zeigt eine Bestandsaufnahme: alle sieben
  Dateien mit Logik tragen `"use client"`, beide Routen (`/` und
  `/checkout/[orderId]`) laufen vollständig im Browser, es gibt keine Server
  Components mit Datenzugriff, keine Route Handlers, kein SSR-Fetching, keine
  Middleware. Next.js lieferte genau drei Dinge: einen Router
  (`useRouter`/`useParams`, drei Stellen), eine Font-Hilfe (`localFont`) und
  ein Build-Setup. Dafür kostete es ein 150–250 MB großes Node-Runtime-Image
  im Deployment, eine bekannte Reibung zwischen `output: "standalone"` und
  pnpm-Symlinks, den `NEXT_PUBLIC_`-Umweg in `run-with-profile.mjs`
  (ADR-034-Nachtrag) und die letzte `tsc`-Ausnahme im Repo, weil
  `next typegen` und der Side-Effect-CSS-Import `tsgo` (ADR-019) blockierten.
  Sonst hing nichts daran: `packages/ui` importiert kein Next, `tests/e2e`
  testet gegen die API, k6 trifft die Web-App nie.
- **Entscheidung:** `apps/web` ist eine reine Single-Page-Application auf
  **Vite + React + React Router**. `vite build` erzeugt statische Dateien in
  `dist/`; zur Laufzeit gibt es keinen Node-Prozess. Client-Routing braucht
  vom ausliefernden Webserver nur einen Fallback auf `index.html`. Öffentliche
  Konfiguration heißt `VITE_API_URL`/`VITE_EVENT_ID` und kommt weiterhin aus
  dem Profil `config/env/<profil>.env` über
  `run-with-profile.mjs --prefix=VITE_`. Das Web-Paket prüft Typen mit `tsgo`
  wie alle anderen Pakete.
- **Begründung:**
  - **Kleinstes Delta.** React, Tailwind, `packages/ui`, alle Komponenten,
    Hooks und die API-Schicht bleiben unverändert; ausgetauscht wurden
    Router-Hooks, die Font-Einbindung (`@font-face`), die Env-Quelle und das
    Build-Werkzeug.
  - **Einfachheit im Deployment.** Ein statisches `dist/` hinter nginx ist
    ~45 MB statt 150–250 MB, braucht keine Probes für einen Node-Server, keine
    Standalone-Tracing-Sonderfälle im pnpm-Monorepo, und die API-URL kann
    später über eine ausgelieferte `config.js` zur Laufzeit gesetzt werden —
    das Standardmuster für SPAs.
  - **Eine Ausnahme weniger.** `check-types` läuft jetzt in jedem Paket mit
    `tsgo`; das offene Phase-6-Todo schließt sich damit.
  - **Kein Einfluss auf das 50k-Ziel.** k6 trifft die API; das Frontend ist
    für die Messkette irrelevant. Der Wechsel ist Rückbau, kein Feature, und
    passt zur Regel „keine neuen Anforderungen in Phase 5".
- **Alternativen:**
  - **Next.js behalten, `output: "export"`:** fast null Aufwand, aber
    `/checkout/[orderId]` bräuchte unter Static Export `generateStaticParams`
    mit zur Build-Zeit unbekannten IDs — Umbau auf `?orderId=` und weiterhin
    154 MB Abhängigkeit für einen Router.
  - **TanStack Start, React Router im Framework-Modus, Remix:**
    SSR-Frameworks, dieselbe Problemklasse wie Next in anderer Form.
  - **Astro:** statisch-zuerst, für zwei Seiten voller Client-State das
    falsche Werkzeug.
  - **Preact:** kleiner, aber Ökosystem-Wechsel ohne Bedarf.
- **Konsequenzen:**
  - Struktur: `apps/web/index.html` → `src/main.tsx` → `src/App.tsx`
    (Routen) → `src/pages/*`; `components/`, `hooks/`, `lib/` liegen unter
    `src/`. `dev`/`preview` laufen auf Port 10001 (`strictPort`).
  - Das frühere `nextjs.json` in `packages/typescript-config/` heißt
    `vite.json` (`moduleResolution: Bundler`, `jsx: react-jsx`);
    `@repo/eslint-config/next-js` und `@next/eslint-plugin-next` sind
    entfernt, `apps/web` nutzt `react-internal`.
  - Profile und `pnpm run debug:env` verlangen `VITE_API_URL` und
    `VITE_EVENT_ID` statt `NEXT_PUBLIC_*`; der Turbo-Build-Output ist nur noch
    `dist/**`, der CI-Cache umfasst nur noch `.turbo`.
  - Das Web-Dockerfile in Phase 5.1 wird ein Zwei-Stufen-Build (Node baut,
    nginx serviert `dist/` mit `try_files $uri /index.html`) — hier bewusst
    noch nicht angelegt, nur der Weg dorthin.
  - `env.ts` validiert beim Laden statt lazy: ohne Prerender-Schritt gibt es
    keinen Grund mehr, einen fehlenden Wert bis zum ersten Klick zu verstecken.
