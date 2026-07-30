# API

Fastify-Gateway für Verfügbarkeit, Reservierung, Payment-Bestätigung,
Checkout-Abbruch und Order-Status.

## Lokale Befehle

Vom Repository-Root:

```bash
pnpm --filter api run dev
pnpm --filter api run test
pnpm --filter api run check-types
pnpm --filter api run lint
pnpm --filter api run start:loadtest
```

Die API läuft standardmäßig auf
[http://localhost:10002](http://localhost:10002). Vor dem Start müssen die
lokale Infrastruktur und `pnpm seed` gelaufen sein; die vollständige
Reihenfolge steht im [`docs/RUNBOOK.md`](../../docs/RUNBOOK.md).

## Grenzen

- Request-, Response- und Event-Verträge kommen aus `packages/types`.
- Verfügbarkeit und Order-Status werden aus Redis gelesen.
- Kaufpfade schreiben nie direkt nach PostgreSQL.
- Pub/Sub-Ressourcen werden lokal durch `pnpm seed` provisioniert, nicht beim
  API-Start.

Aktuelles Verhalten und Datenfluss:
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
