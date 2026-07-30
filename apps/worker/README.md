# Worker

Fastify-Service für Pub/Sub-Consumption, PostgreSQL-Persistenz,
Redis-Finalisierung und Inventory-Hintergrundaufgaben.

## Lokale Befehle

Vom Repository-Root:

```bash
pnpm --filter worker run dev
pnpm --filter worker run test
pnpm --filter worker run check-types
pnpm --filter worker run lint
pnpm --filter worker run start:loadtest
```

Der Health-/Metrics-Server läuft standardmäßig auf
[http://localhost:10003](http://localhost:10003). Vor dem Start müssen
PostgreSQL, Redis und Pub/Sub laufen und `pnpm seed` muss Topic sowie
Subscription angelegt haben.

## Grenzen

- Events und Redis-Keys kommen aus `packages/types`.
- Datenbankzugriffe laufen über `packages/db`.
- Redelivery, ACK/NACK und Kompensation folgen der Policy in
  [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#worker-outcome-policy).
- Der gebaute Lasttest-Modus ist im
  [`docs/RUNBOOK.md`](../../docs/RUNBOOK.md#3-lasttest-stack-hochfahren-gebauter-stand)
  beschrieben.
