# Web

Next.js-Frontend für Sale-Status, Reservierung, simuliertes 3DS und
Order-Tracking. Styling erfolgt ausschließlich mit Tailwind CSS.

## Lokale Befehle

Vom Repository-Root:

```bash
HTS_ENV_PROFILE=dev pnpm --filter web run dev
pnpm --filter web run build            # inlined NEXT_PUBLIC_* aus dem Profil (Default: dev)
pnpm --filter web run check-types
pnpm --filter web run lint
```

`NEXT_PUBLIC_API_URL` und `NEXT_PUBLIC_EVENT_ID` kommen aus dem Profil
`config/env/<profil>.env`, aus dem `dev`/`start`/`build` über
`scripts/lib/run-with-profile.mjs --prefix=NEXT_PUBLIC_` genau die
Frontend-Variablen ins Prozess-Env laden (ADR-034; `node --env-file` scheidet
aus, weil Next.js es an seine Worker-Threads weiterreicht und Node das ablehnt;
der Rest des Profils — etwa `NODE_ENV` — bleibt draußen, weil `next build`
damit bricht) — eine `apps/web/.env.local` ist nicht nötig; liegt noch eine, hat
das Profil Vorrang. `dev` und `start` verlangen `HTS_ENV_PROFILE`, `build` fällt
auf `dev` zurück, weil die Frontend-Werte in allen Profilen identisch sind und
`pnpm build` sonst überall ein Profil bräuchte.

Die Anwendung läuft standardmäßig auf
[http://localhost:10001](http://localhost:10001) und erwartet die API auf Port
`10002`. Für den vollständigen Stack:

```bash
docker compose up -d
pnpm seed
pnpm dev
```

Fachliches Verhalten:
[`docs/REQUIREMENTS.md`](../../docs/REQUIREMENTS.md). Datenfluss:
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
