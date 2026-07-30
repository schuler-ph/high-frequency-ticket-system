# Web

Next.js-Frontend für Sale-Status, Reservierung, simuliertes 3DS und
Order-Tracking. Styling erfolgt ausschließlich mit Tailwind CSS.

## Lokale Befehle

Vom Repository-Root:

```bash
pnpm --filter web run dev
pnpm --filter web run build
pnpm --filter web run check-types
pnpm --filter web run lint
```

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
