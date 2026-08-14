# Stage 2 — DB-Hot-Row (naechster echter Limiter nach dem Sleep-Removal)

Abgeschlossene Detailnotiz zur DB-Hot-Row-Arbeit nach Phase 4.3.

## #7 isoliert benchmarken

> - [x] #7 isoliert benchmarken (vor Umsetzung): Flow-Control >1.000 setzen und DB-Pool-Wait/Query-/Lock-Wait messen. **Neu gefasst:** der frueher noetige Schritt "Payment-Mock deaktivieren" entfaellt — mit dem Worker-Sleep-Removal aus Phase 4.3 ist der 1-s-Mock weg, der `sold_count`-Hot-Row-UPDATE ist damit direkt als Limiter isolierbar (Baseline A traf nur den 500/s-Flow-Control-Deckel und bewies den Hot-Row-Limiter nicht separat). — Fokussierter Publish-Micro-Bench `scripts/local/bench-hot-row.mjs` (`pnpm bench:hot-row`, published `BuyTicketEvent`s direkt an Pub/Sub, misst Drain-Durchsatz + `pg_stat_activity`-Lock-Wait-Backends + Worker-`/metrics`). BEFORE mit `FLOW_CONTROL=2000`/`POOL_MAX=50`: **235 tickets/s, 49/50 Backends im Lock-Wait** auf der einen `events`-Row — Hot-Row als Limiter bewiesen (`docs/reports/hot-row-bench/README.md`).

## #7 buy_ticket ohne sold_count-Hot-Row

> - [x] #7: `buy_ticket` ohne `sold_count`-Hot-Row-UPDATE (Aggregation im Reconcile); Order direkt als `completed` einfuegen (ADR-011-Update, Migration + `db:push`, Guardrail-Script `check-buy-ticket-contract.mjs`). — Migration `0009_buy_ticket_without_sold_count_hot_row.sql` (via `db:apply-sql` angewendet + in Postgres verifiziert; `db:push` zeigt keinen Schema-Drift, Spalte bleibt). `listEventInventorySnapshots` liest den Verkaufsstand jetzt via `COUNT(tickets)`; neuer `persistEventSoldCounts` schreibt ihn im Reconcile-Loop als Snapshot nach `events.sold_count` zurueck (optionaler `persistSoldCounts`-Dep, erst nach der Redis-Korrektur). Guardrail erzwingt den Direkt-`completed`-Insert **und** die Abwesenheit des `sold_count`-Increments. Tests aktualisiert (db-Integration, order-processing inkl. abgeleitetem Snapshot, Reconcile-Write-Back + Fehlerreihenfolge, e2e Happy-Path gruen). AFTER-Bench: **26.385 tickets/s bei 0 Lock-Wait-Backends** (~112× vs. BEFORE), Reconcile materialisierte `sold_count` korrekt (`docs/reports/hot-row-bench/README.md`).
