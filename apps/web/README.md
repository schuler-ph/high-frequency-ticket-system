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
pnpm --filter web run dev      # Dev-Server auf :10001
pnpm --filter web run build    # statisches dist/
pnpm --filter web run preview  # dist/ auf :10001 ausliefern
pnpm --filter web run check-types
pnpm --filter web run lint
```

## Konfiguration

Keine. `apps/web` hat keine Env-Variablen und braucht kein `HFTS_ENV`
(ADR-043) — auch nicht für `dev` und `preview`.

- **API-Adresse:** das Frontend kennt sie nicht. `src/lib/api.ts` ruft
  `/api/...` relativ auf, den gemeinsamen Origin stellt ein Reverse Proxy her
  — nginx im Container, der Ingress in GKE, lokal `server.proxy` und
  `preview.proxy` in [`vite.config.ts`](vite.config.ts) mit Ziel `:10002`.
- **Event-Id:** `MAIN_SALE_EVENT_ID` aus `@repo/types/tickets`.

Damit steht keine Umgebungsadresse im Bundle: dasselbe `dist/` und dasselbe
Container-Image laufen in jeder Umgebung. **Voraussetzung ist der Proxy** —
ohne eine `/api/`-Regel vor Web und API läuft das Frontend ins Leere.

Die Anwendung läuft standardmäßig auf
[http://localhost:10001](http://localhost:10001) und erwartet die API auf Port
`10002`. Für den vollständigen Stack:

```bash
docker compose up -d
pnpm seed
pnpm dev
```

Beim Ausliefern von `dist/` über einen Webserver braucht das Client-Routing
einen Fallback auf `index.html` (nginx: `try_files $uri /index.html`) und eine
Proxy-Regel für `/api/`.

Fachliches Verhalten:
[`docs/REQUIREMENTS.md`](../../docs/REQUIREMENTS.md). Datenfluss:
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
