# ADR-004: Asynchrone Writes über Pub/Sub

- **Datum:** 2026-02-24
- **Kontext:** Bei Lastspitzen (Ticket-Sale-Start) würden direkte DB-Schreibzugriffe die PostgreSQL-Instanz überlasten. Die API muss sofort antworten können, unabhängig von der DB-Kapazität.
- **Entscheidung:** API published Kauf-Intents in Google Cloud Pub/Sub, Worker konsumiert und schreibt in DB.
- **Begründung:** Entkopplung von Spike-Traffic und DB-Write-Kapazität. API kann sofort HTTP 202 (Accepted) antworten. Pub/Sub garantiert At-Least-Once Delivery. Worker kann unabhängig skaliert werden.
- **Alternativen:** Direktes DB-Write mit Connection Pooling (skaliert nicht ausreichend), Redis Streams (weniger Feature-reich als Pub/Sub).

### Update 2026-03-13: ACK/NACK-Regeln im Worker

- **Kontext:** Für At-Least-Once Delivery muss klar definiert sein, wann der Worker ACK (terminal) und wann NACK (retrybar) sendet.
- **Entscheidung:**
  - ACK bei erfolgreicher Verarbeitung.
  - ACK bei terminalem Business-Fehler `P0001` (Event nicht gefunden).
  - NACK bei technischen/transienten Fehlern (z.B. DB-Write-Fehler).
  - NACK bei nicht parsebarem JSON und aktuell auch bei Schema-Validation-Fehlern.
- **Begründung:** Retries sollen nur dort stattfinden, wo sie potenziell erfolgreich sein können. Deterministische Business-Fehler werden nicht erneut zugestellt.
- **Umsetzung:**
  - `apps/worker/src/routes/pubsub-listener.ts`
  - `apps/worker/test/routes/pubsub-listener.test.ts`
  - `apps/worker/test/plugins/pubsub.test.ts`

### Update 2026-03-21: Kompensation bei terminalem Worker-Fehler

- **Kontext:** Bei terminalen Business-Fehlern (z.B. `P0001` Event nicht gefunden) darf die Nachricht nicht erneut dauerhaft redelivered werden, gleichzeitig muss eine zuvor in der API gesetzte Reservation korrekt freigegeben werden.
- **Entscheidung:** Der Worker fuehrt im terminalen Fehlerpfad eine atomare Redis-Kompensation aus (`DEL reservationKey` + `INCR available`) und ACKt nur bei erfolgreicher (oder bereits erfolgter) Freigabe.
- **Begruendung:** So bleibt der Availability-Counter konsistent ohne Double-Increment bei Redelivery. Falls die Kompensation technisch fehlschlaegt, wird NACK gesendet, damit ein Retry die Freigabe nachholen kann.
- **Umsetzung:**
  - `apps/worker/src/routes/pubsub-listener.ts`
  - `apps/worker/src/plugins/redis.ts`
  - `apps/worker/test/routes/pubsub-listener.test.ts`

### Update 2026-03-21: Worker-Idempotenz via `orderId`

- **Kontext:** Pub/Sub liefert Nachrichten mindestens einmal aus. Bei Redelivery derselben `orderId` darf der Worker keinen zweiten DB-Write ausfuehren.
- **Entscheidung:** Der Worker verwendet Redis-Keys pro `eventId` + `orderId` fuer Idempotenz:
  - `processing`: kurzlebiger Lock waehrend aktiver Verarbeitung
  - `processed`: Marker fuer bereits final verarbeitete Orders
- **Begruendung:** Redeliveries mit vorhandenem `processed`-Marker werden sofort ge-ACKt, ohne erneuten DB-Aufruf. Gleichzeitige Zustellungen derselben Order konkurrieren ueber den `processing`-Lock; nicht gewinnende Zustellungen werden ge-NACKt und spaeter erneut zugestellt.
- **Umsetzung:**
  - `packages/types/src/redis-keys.ts`
  - `packages/env/src/index.ts`
  - `apps/worker/src/routes/pubsub-listener.ts`
  - `apps/worker/test/routes/pubsub-listener.test.ts`

### Update 2026-07-14: Idempotenz-Schicht = DB-Transaktion; `processing`-Lock entfernt

- **Kontext:** Die `buy_ticket`-SQL-Function (Migration 0008) ist eine einzelne Transaktion mit `INSERT INTO orders … ON CONFLICT (id) DO NOTHING`, die bei Duplikaten das existierende Ticket zurueckliefert — sie ist damit bereits vollstaendig idempotent und nebenlaeufigkeitssicher. Der Redis-`processing`-Lock duplizierte diese Garantie: Sein einziger Effekt war, dass parallele Doppel-Zustellungen sofort ge-NACKt wurden und heiss rotierten, statt harmlos in den `ON CONFLICT`-Pfad zu laufen (vgl. `docs/reports/ANALYSIS-STANDARD-FLOW.md`, Befund D1 / Massnahme 4).
- **Entscheidung:** Der `processing`-Lock entfaellt ersatzlos (Key-Familie, SET-NX-Erwerb, Release im `finally`, Lock-Conflict-NACK-Pfad, `processing_lock_conflicts_total`-Metrik samt Dashboard-Panels, `REDIS_WORKER_PROCESSING_LOCK_TTL_SECONDS`). Die Idempotenz-Garantie traegt explizit die DB-Transaktion. Der `processed`-Marker **bleibt** als reine Redis-Optimierung: Redeliveries werden weiterhin sofort ge-ACKt und sparen den 1-s-Payment-Sleep plus DB-Roundtrip.
- **Begruendung:** Das Learning "Idempotenz via `orderId`" wird nicht verletzt, sondern in die Schicht verlagert, die es laengst implementiert. Parallele Doppel-Zustellungen (selten) serialisieren an der Row-Lock der ersten `INSERT` und landen im Conflict-Pfad — Ergebnis: beide Zustellungen werden als `completed` ge-ACKt, kein doppelter `sold_count`, kein NACK-Hot-Loop. Weniger Zustaende, weniger Fehlerpfade, 1 Redis-Roundtrip weniger vor jedem DB-Write.
- **Umsetzung:**
  - `apps/worker/src/lib/handle-buy-ticket-message.ts` (kein `finally`/Lock-Release mehr)
  - `apps/worker/src/lib/redis-scripts.ts` (`beginOrderProcessing`-Script entfaellt, Finalize ohne Lock-DEL)
  - `apps/worker/src/routes/pubsub-listener.ts` / `apps/worker/src/lib/metrics.ts`
  - `packages/types/src/redis-keys.ts` / `packages/env/src/index.ts` / `.env.test`
  - `monitoring/grafana/provisioning/dashboards/worker-reliability.json`
  - `docs/ARCHITECTURE.md` (Key-Lifecycle- und ACK/NACK-Tabelle)
