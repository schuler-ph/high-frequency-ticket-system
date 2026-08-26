# Phase 4.4: Weg zur Baseline B (Folgearbeit aus Phase 4–4.2)

Abgeschlossene Detailnotiz zum Weg zur Baseline B. Die Stage-Details liegen in den verlinkten Backlog-Notizen. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

Nach dem Reserve/Pay-Split gebündelte Folgearbeit aus den Phasen 4–4.2: erst den `sold_count`-Hot-Row als nächsten Limiter entfernen, dann günstige Cleanups, dann der Kapazitätsnachweis (Baseline B).

Details: [stage-2-db-hot-row](../backlogs/stage-2-db-hot-row.md) · [stage-3-pre-baseline-cleanups](../backlogs/stage-3-pre-baseline-cleanups.md) · [stage-4-capacity-evidence](../backlogs/stage-4-capacity-evidence.md) · [local-generator-split](../backlogs/local-generator-split.md)

### DB-Hot-Row (nächster echter Limiter nach dem Sleep-Removal)

- [x] **#7 isoliert benchmarken:** Micro-Bench `pnpm bench:hot-row` weist den `sold_count`-Hot-Row als Limiter nach — 235 tickets/s bei 49/50 Backends im Lock-Wait.
- [x] **#7 `buy_ticket` ohne `sold_count`-Hot-Row:** Verkaufsstand via `COUNT(tickets)` im Reconcile aggregiert (Migration 0009) — 26.385 tickets/s bei 0 Lock-Wait (~112×). → ADR-011

### Pre-Baseline-Cleanups (günstig, vor dem Kapazitätslauf gebündelt)

- [x] **#9 Pub/Sub-Provisioning nach `scripts/local`:** Runtime-Clients von Provisioning und `*Like`-Schattentypen befreit.
- [x] **Sale-Unlock-Gate gegen echtes Redis testen:** alle Gate-Fälle plus Sold-Out abgedeckt. → ADR-024
- [x] **`409`/`425` und die neuen Pay/Cancel-Fehler im Response-Schema deklarieren:** wiederverwendbare Fabrik `httpErrorResponseSchema` statt Copy-Paste.
- [x] **k6-Checkout-Funnel:** `runCheckout()` fährt buy → pay → optionalen Status-Poll.
- [x] **Abandonment + Think-Time im Funnel modellieren:** ~88 % pay / ~8 % cancel / ~4 % Abbruch, Denkzeit als k6-`sleep()` in zwei Profilen (capacity/realism).
- [x] **Sold-Out-Erkennung korrigieren:** Plateau von `orders_completed_total` statt `available`. → ADR-025
- [x] **k6-Metriken klassifizieren:** Funnel, Endpoint/Status und Transportfehler.

### Kapazitätsnachweis (System jetzt sleeplos + Hot-Row-optimiert)

- [x] **Dedizierter LoadTest-Run gegen gebauten Stand:** `start:loadtest` in API und Worker (gebaut, ohne `-P`/pino-pretty, ohne `tsc-watch`) statt `pnpm dev`.
- [x] **Request-Logging abschaltbar machen:** `DISABLE_REQUEST_LOGGING` für API und Worker.
- [x] **Worker-Resubscribe nach Seed/Reset:** Subscription wird idempotent wiederhergestellt.
- [x] **MVP der Report-Automation umgesetzt:** `scripts/load-test/` (pur/side-effecting getrennt), Kommandos `spike:report`/`:analyze`/`:compare`, 47 Tests + Goldens.
- [x] ~~Generator vom SUT trennen fuer 50k RPS (~20k VUs, 0 dropped).~~ **Verworfen 2026-08-14:** per REQ-P02 ein Cloud-Ziel (→ Phase 4.11 + 5); lebt lokal in Phase 4.12 weiter.
- [x] **Baseline B ausgefuehrt (2026-07-26):** `benchmark=invalid` (67,66 % dropped, Generator-Saturation), fachlich korrekt: 867.575 Orders, 0 Verlust, E2E 406 s → 7,52 s.
- [x] **Sold-Out-Fehlalarm durch alten Completion-Counter:** Plateau zählt relativ zur Poll-Baseline.
