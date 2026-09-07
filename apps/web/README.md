# Web

Vite + React Single-Page-App für Sale-Status, Reservierung, simuliertes 3DS
und Order-Tracking (ADR-039). Routing mit React Router (`/` und
`/checkout/:orderId`), Styling ausschließlich mit Tailwind CSS. `vite build`
erzeugt statische Dateien in `dist/`; zur Laufzeit läuft kein Node.

## Struktur

```
index.html          Einstieg, lädt src/main.tsx
src/main.tsx        React-Root + BrowserRouter
src/App.tsx         Routen
src/pages/          TicketPage (/), CheckoutPage (/checkout/:orderId)
src/components/     Chrome, PaymentForm, OfferHeadline, Toast, …
src/hooks/          Polling und Deadline
src/lib/            API-Client, Env, Namen, Angebot, Payment
src/index.css       Tailwind-Import, Fonts, Theme
```

## Lokale Befehle

Vom Repository-Root:

```bash
HTS_ENV_PROFILE=dev pnpm --filter web run dev      # Dev-Server auf :10001
pnpm --filter web run build                        # inlined VITE_* aus dem Profil (Default: dev)
HTS_ENV_PROFILE=dev pnpm --filter web run preview  # dist/ auf :10001 ausliefern
pnpm --filter web run check-types                  # tsgo
pnpm --filter web run lint
```

`VITE_API_URL` und `VITE_EVENT_ID` kommen aus dem Profil
`packages/env/profiles/<profil>.env`, aus dem `dev`/`preview`/`build` über
`scripts/lib/run-with-profile.mjs --prefix=VITE_` genau die
Frontend-Variablen ins Prozess-Env laden (ADR-034 Nachträge 2026-08-25 und
2026-08-27). Vite liest `.env`-Dateien nur aus dem eigenen Verzeichnis, das
Profil erreicht den Build also nur über diesen Weg; der Rest des Profils —
etwa `NODE_ENV` — bleibt draußen. `dev` und `preview` verlangen
`HTS_ENV_PROFILE`, `build` fällt auf `dev` zurück, weil die Frontend-Werte in
allen Profilen identisch sind und `pnpm build` sonst überall ein Profil
bräuchte. Fehlt ein Wert, bricht `src/lib/env.ts` beim Laden der App sichtbar
ab.

Die Anwendung läuft standardmäßig auf
[http://localhost:10001](http://localhost:10001) und erwartet die API auf Port
`10002`. Für den vollständigen Stack:

```bash
docker compose up -d
pnpm seed
pnpm dev
```

Beim Ausliefern von `dist/` über einen Webserver braucht das Client-Routing
einen Fallback auf `index.html` (nginx: `try_files $uri /index.html`).

Fachliches Verhalten:
[`docs/REQUIREMENTS.md`](../../docs/REQUIREMENTS.md). Datenfluss:
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
