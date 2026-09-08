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
HTS_ENV_PROFILE=dev pnpm --filter web run build    # inlined VITE_* aus dem Profil
HTS_ENV_PROFILE=dev pnpm --filter web run preview  # dist/ auf :10001 ausliefern
pnpm --filter web run check-types                  # tsgo
pnpm --filter web run lint
```

`VITE_API_URL` und `VITE_EVENT_ID` kommen aus dem Profil
`packages/env/profiles/<profil>.env`. `vite.config.ts` holt sie über
`profileVarsWithPrefix("VITE_")` aus `@repo/env/profile` und übernimmt genau
die Frontend-Variablen ins Prozess-Env (ADR-034 Nachtrag 2026-09-08). Vite
liest `.env`-Dateien nur aus dem eigenen Verzeichnis, das Profil erreicht den
Build also nur über diesen Weg; der Rest des Profils — etwa `NODE_ENV` — bleibt
draußen, weil er Vites Modus-Erkennung überschreiben würde. Alle drei Skripte
verlangen `HTS_ENV_PROFILE` und brechen ohne Profil mit der Profilliste ab; es
gibt keinen Default, denn `vite build` backt die Werte in das Bundle. Fehlt ein
Wert, bricht `src/lib/env.ts` beim Laden der App sichtbar ab.

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
