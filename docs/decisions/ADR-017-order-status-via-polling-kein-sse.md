# ADR-017: Order-Status via Polling (kein SSE)

- **Datum:** 2026-03-12
- **Kontext:** Das Ticket-Kaufen ist asynchron (Pub/Sub + Worker). Der Client braucht eine verlässliche Rueckmeldung, ob der Kauf abgeschlossen ist, ohne die API-Request-Latenz zu erhoehen oder den Worker direkt mit dem Browser zu verbinden.
- **Entscheidung:** Die API liefert beim Kauf ein `orderId` (z.B. aus dem Request oder generiert) und der Client pollt einen Status-Endpunkt (`GET /api/orders/{orderId}`) bis `completed|failed` erreicht ist.
- **Begruendung:** Polling ist einfach, robust und passt zur entkoppelten Architektur. Der Worker schreibt den finalen Status in die Datenbank und materialisiert zusaetzlich ein Redis-Read-Model; die API liest fuer den Client ausschließlich aus Redis und bleibt damit komplett PostgreSQL-frei. Kein direkter Worker-Client-Kanal, keine zusaetzliche Persistenz fuer SSE-Verbindungszustand.
- **Alternativen:**
  - **Server-Sent Events:** wuerde einen dauerhaften API-Client-Kanal erfordern und zusaetzliche Infrastruktur/State-Management (Reconnect, Lastverteilung) benoetigen.
  - **WebSockets:** aehnlich wie SSE, aber komplexer im Betrieb, besonders unter Lastspitzen.
  - **Kein Status-Feedback:** schlechter UX und fuer das Demo-Szenario unzureichend.

### Update 2026-04-22: Sofort beobachtbarer Pending-Status nach `202 Accepted`

- **Kontext:** Zwischen `POST /api/tickets/:eventId/buy` und der spaeteren Worker-Persistenz existierte eine Luecke: Direkt nach `202 Accepted` war der Auftrag fuer einen geplanten `GET /api/orders/:orderId` noch nicht konsistent lesbar, weil die API keine DB schreiben darf und die Order erst im Worker entsteht.
- **Entscheidung:** Die API schreibt nach erfolgreicher Redis-Reservation einen temporaeren Pending-Status pro `orderId` in einen stabilen Redis-Key `orders:{orderId}` mit eigener Pending-TTL. Der Worker ueberschreibt denselben Key spaeter mit `completed` plus `ticketId` oder `failed` plus `failureReason` und verwendet dafuer eine laengere Final-Status-TTL. Bei Publish-Fehlern bleibt das kritische Inventory-Rollback (`reservation` loeschen + `available` kompensieren) garantiert; Order-Status-Cleanup ist nachgelagert und darf dieses Rollback nicht blockieren.
- **Begruendung:** So bleibt der Buy-Flow DB-write-frei, waehrend der spaetere Order-Read-Pfad unmittelbar nach `202 Accepted` einen stabilen Pending-Status aus Redis nutzen kann und spaeter ohne Key-Wechsel denselben Redis-Eintrag als finales Read-Model liest. Die laengere Final-Status-TTL verhindert dabei, dass `completed|failed` deutlich frueher verschwinden als die Worker-Idempotenz- und Polling-Fenster.
- **Umsetzung:**
  - `packages/types/src/redis-keys.ts`
  - `packages/types/src/tickets.ts`
  - `apps/api/src/routes/api/tickets/buy.ts`
  - `apps/api/test/routes/tickets.buy.test.ts`
  - `apps/worker/src/lib/handle-buy-ticket-message.ts`
  - `apps/worker/src/routes/pubsub-listener.ts`
  - `apps/worker/test/routes/pubsub-listener.test.ts`
