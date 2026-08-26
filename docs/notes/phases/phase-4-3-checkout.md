# Phase 4.3: Checkout & Payment-Simulation (Web + API)

Abgeschlossene Phasenspezifikation zum Reserve/Pay-Split und Checkout. Die verbindliche Entscheidung steht in ADR-028.

### Phase 4.3: Ziel und Leitentscheidung

> Ziel: Der Kauf laeuft nicht mehr als ein einziger `POST /buy`-Klick, sondern als realistischer Checkout — Reservierung beim "Kaufen", ein Payment-Modal mit simuliertem 3DS, und danach ein Live-Order-Status auf derselben Seite. Leitentscheidung (siehe neuen ADR-028): **`POST /buy` reserviert nur, die neue synchrone Pay-Route published** — das Ticket ist waehrend der Zahlung gehalten, der Worker sieht die Order erst nach bestaetigter Zahlung.

### Wo lebt die Payment-Latenz?

> **Wo lebt die Payment-Latenz?** Der 1-s-Payment-Mock verlaesst das Backend vollstaendig: Der Worker-Sleep wird entfernt, und die Pay-Route macht **keinen** Server-Sleep. Die simulierte 3DS-Verzoegerung ist ein reines Frontend-UX-Artefakt (Spinner/OTP im Modal). Damit hat das Backend nirgends kuenstliche Latenz — Worker und `/pay` sind beide ~ms-schnell, und der Lasttest misst echte Infra-Kapazitaet statt eines Mock-Sleeps (genau die Falle von Baseline A). Konsequenz: k6 faehrt `/buy`→`/pay` back-to-back ohne Payment-Delay; eine bewusste "N gehaltene Reservierungen waehrend Checkout"-Simulation waere ein explizites `sleep()` im k6-Skript, kein Backend-Verhalten (ADR-028).

## Backend: Reserve/Pay-Split (`apps/api` + `packages/types`)

### Buy entkoppeln

> - [x] **Buy entkoppeln:** `POST /api/tickets/:eventId/buy` reserviert nur noch (Lua: `DECR available` + Ledger-`ZADD` + `pending`-Order) und liefert `orderId` + `202`, **ohne** Pub/Sub-Publish. Der bisherige Publish-Rollback-Pfad entfaellt an dieser Stelle (kein Publish mehr im Buy). Der Reservierungs-Record traegt jetzt `firstName`/`lastName`, damit die Pay-Route den `BuyTicketEvent` rekonstruieren kann. Buy-Route-Unit-Tests und die E2E-Flow-Tests auf Reserve-only umgestellt (Response-Message `Ticket reserved`); die publish-/worker-abhaengigen E2E-Flows kehren mit der Pay-Route zurueck.

### Payment-DTO in packages/types

> - [x] **Payment-DTO in `packages/types`:** Zod-Schema fuer den (simulierten) Payment-Request (`cardHolder`, `cardNumber`, `expiry`, `cvc`) + Response (`confirmed`, `orderId`). Keine echten Kartendaten — reine Simulation; im Schema klar als Fake/Dummy kennzeichnen und keine Persistenz der Zahlungsdaten. Zusaetzlich `pendingOrderReservationSchema` (Pending-Status + `firstName`/`lastName`) ergaenzt, damit die Pay-Route den Kaeufer aus `orders:{orderId}` rekonstruieren kann; der oeffentliche `GET /orders`-Status-Contract bleibt via schmalerem `orderStatusResponseSchema` unveraendert.

### Worker-Sleep entfernen

> - [x] **Worker-Sleep entfernen:** Den 1-s-Payment-Mock in `apps/worker/src/lib/handle-buy-ticket-message.ts` (`await (deps.sleep ?? setTimeout)(1000)`) samt `sleep`-Dependency und zugehoerigen Tests geloescht. Der Worker ist jetzt reiner Persist-Consumer (`buy_ticket` + `ZREM` + Finalisierung). Stale-Kommentar in `packages/env/src/index.ts` und die Flow-Control-/Durchsatz-Notiz in `ARCHITECTURE.md` korrigiert. (Loest das Phase-3-Todo "Simuliere Payment-Provider Latenz (1s Sleep)" ab.)

### Synchrone Pay-Route

> - [x] **Synchrone Pay-Route:** `POST /api/orders/:orderId/pay` — validiert das Payment-DTO und **published** `BuyTicketEvent` an Pub/Sub, antwortet synchron (`200`, sobald der Publish bestaetigt ist). **Kein Server-Sleep** — die 3DS-Verzoegerung ist Frontend-UX (siehe Leitentscheidung oben). Async-Writes-Regel bleibt gewahrt: die Route schreibt niemals in PostgreSQL, sie published nur; die Persistenz traegt weiterhin der Worker. `queuedAt` wird beim Publish (Pay-Zeitpunkt) gesetzt, damit die E2E-Latenz nur noch Publish→Persist misst. Kaeuferdaten stammen aus dem Reservierungs-Record; fehlende Reservierung → `404`, bereits finalisierte Order → `409`. Neuer Counter `payments_confirmed_total`.

### Checkout-Abbruch und Timeout behandeln

> - [x] **Checkout-Abbruch/Timeout behandeln:** Bricht der Nutzer das Modal ab oder scheitert 3DS, bleibt die Ledger-Reservierung sonst als Phantom-Anspruch stehen (ZSet ohne TTL, ADR-027). Explizite Release-Route (`POST /api/orders/:orderId/cancel`, ruft `releaseTicketReservation`) ergaenzt: idempotent (fehlende Reservierung → `cancelled: false`), bereits finalisierte Order → `409`; das Aufraeumen wirklich verwaister Reservierungen bleibt beim Reaper (Phase 6). Neuer Counter `checkouts_cancelled_total` (nur bei tatsaechlicher Freigabe).

### Metriken und Observability nachziehen

> - [x] **Metriken/Observability nachziehen:** (a) `order_e2e_latency_seconds` misst nach dem Split nur noch Publish→Persist (~ms statt ~406 s) — die auf Baseline A getunten 600-s-Buckets (`apps/worker/src/lib/metrics.ts`) auf eine Millisekunden-Leiter (`[0.001 … 10]`) zurueckgenommen und `queuedAt`-Semantik in ADR-023 (Nachtrag 2026-07-17) angepasst. (b) Checkout-Funnel-Counter ergaenzt: `reservations_created` (Buy), `payments_confirmed` (Pay), `checkouts_cancelled` (Cancel) — Counter landeten mit ihren jeweiligen Routen; Grafana-Order-Lifecycle-Dashboard um Funnel-Panel + Abandon-Rate-Gauge (PromQL: `1 − paid/reserved`) erweitert.

### Tests zum Reserve/Pay-Split

> - [x] **Tests:** Pay-Route (Happy Path publish + `200`, `404`/`409`, Publish-Fehler → Rollback, Aggregate-Error), Cancel-Route (Release + idempotent + `409` auf finalisiert), Worker ohne Sleep (Persist-Only, keine `deps.sleep`-Dependency mehr), sowie die End-to-End-Flow-Tests (`tests/e2e/`) auf `buy` (reserve) → `pay` (publish) → Worker → `GET /api/orders/:orderId` umgestellt (Happy `completed`, Pay-Publish-Rollback, terminaler P0001-`failed`-Pfad, Sold-Out `409`).

### ADR-028 und Doku-Lockstep

> - [x] **ADR-028 + Doku-Lockstep:** Neuer ADR-028 (Reserve→Pay→Publish-Split; Payment-Latenz lebt im Frontend, nicht im Backend; Interaktion mit Async-Writes-Regel und Reservation-Ledger ADR-027) angelegt. ADR-013 (Payment Flow Mocking) annotiert: Mock wandert Worker→Frontend. ADR-023 (E2E-Observability) auf neue `queuedAt`-Semantik aktualisiert. `ARCHITECTURE.md` Happy-Path (jetzt 9 Schritte: buy reserviert, pay published, Worker ohne Sleep), Flow-Diagramm (`/buy` ohne Publish; neue `/pay`+`/cancel`) und Redis-Key-Lifecycle (Ledger spannt den Checkout; Pending-TTL deckt das Zahlungsfenster) aktualisiert. `REQUIREMENTS.md` um eine API-Surface-Tabelle inkl. `/pay` + `/cancel` ergaenzt.

## Frontend: Checkout-Flow (`apps/web`)

### Auto-Fill Namen

> - [x] **Auto-Fill Namen:** Vor-/Nachname-Inputs beim Betreten der `open`-Phase mit zufaelligen Namen vorbefuellen (kleiner clientseitiger Name-Generator, keine externe Dependency); weiterhin editierbar. — `apps/web/lib/names.ts` (Generator ohne Dependency), `ActiveSaleView` befuellt Vor-/Nachname lazy beim Mount und re-randomisiert nach erfolgreichem Kauf.

### Payment-Modal

> - [x] **Payment-Modal:** Nach "Ticket kaufen" zuerst `POST /buy` (Reservierung), dann Tailwind-Modal oeffnen mit vorbefuellten Fake-Zahlungsdaten (Karteninhaber, Kartennummer, Ablaufdatum, CVC). Kein CSS ausserhalb von Tailwind. — `components/PaymentModal.tsx` (Tailwind-only), `lib/payment.ts` (Fake-Karten-Generator, 4242-Testnummer), `payOrder`/`cancelOrder` in `lib/api.ts`; `ActiveSaleView` oeffnet das Modal mit der `orderId` aus dem Reserve-Response.

### Fake-3DS-Challenge

> - [x] **Fake-3DS-Challenge:** Nach "Bezahlen" einen simulierten 3DS-Schritt anzeigen (z. B. Spinner/OTP-Prompt), der `POST /api/orders/:orderId/pay` aufruft; Erfolg/Fehler sauber im Modal behandeln. — `PaymentModal`-Statemachine `form → challenge → processing`: "Bezahlen" oeffnet den 3DS-OTP-Prompt (vorbefuellter Sim-Code), erst "Bestätigen" ruft `POST /pay`; Fehler (`404`/`409`/sonstige) landen als Banner zurueck im Kartenformular.

### Modal-Abbruch

> - [x] **Modal-Abbruch:** Beim Schliessen/Abbrechen des Modals `POST /api/orders/:orderId/cancel` aufrufen, damit die Reservierung freigegeben wird. — `handleCancelCheckout` in `ActiveSaleView` gibt beim Modal-Close (X/Abbrechen/Backdrop/Escape) die Reservierung idempotent frei (fire-and-forget, UI wird sofort zurueckgesetzt); `onPaid` loest **keinen** Cancel aus.

### Neue tracking-Phase

> - [x] **Neue `tracking`-Phase:** Nach erfolgreicher Zahlung auf eine neue Inline-Phase der Single-Page umschalten (bestehendes `Phase`-Modell `loading|upcoming|open|soldout` um `tracking` erweitern), die den Order-Status anzeigt. — `Phase` um `tracking` erweitert; `trackingOrderId` auf `TicketPage`-Ebene hat Vorrang vor der Verfuegbarkeits-Phase, `ActiveSaleView.onPaid` hebt nach bestaetigter Zahlung dorthin. Neue `TrackingView` (Order-Kurz-ID + „Neues Ticket“-Reset); Live-Polling folgt im naechsten Todo.

### Live-Order-Status

> - [x] **Live-Order-Status:** In der `tracking`-Phase `GET /api/orders/:orderId` pollen (Backoff/Jitter aus Phase 6 optional beruecksichtigen) und `pending → completed|failed` inkl. Ticket-Referenz live darstellen; Fehl-/Failed-Status verstaendlich anzeigen. — `hooks/useOrderStatus.ts` pollt (2 s + Jitter) und stoppt bei Final-Status; `fetchOrderStatus` in `lib/api.ts`; `TrackingView` rendert `pending` (Spinner), `completed` (Ticket-Referenz) und `failed` (`failureReason`) live.

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

Ziel: Reservierung, simuliertes 3DS und Live-Status. `/buy` reserviert; erst `/pay` publiziert (ADR-028). → [Details](#phase-43-ziel-und-leitentscheidung)

**Wo lebt die Payment-Latenz?** Nirgends im Backend — Worker-Sleep entfernt, `/pay` ohne Server-Sleep; die 3DS-Verzoegerung ist reines Frontend-UX. k6 faehrt `/buy`→`/pay` back-to-back (ADR-028). → [Details](#wo-lebt-die-payment-latenz)

### Backend: Reserve/Pay-Split (`apps/api` + `packages/types`)

- [x] **Buy entkoppeln:** `POST /api/tickets/:eventId/buy` reserviert nur noch (Lua: `DECR available` + Ledger-`ZADD` + `pending`-Order) und liefert `orderId` + `202`, **ohne** Publish.
- [x] **Payment-DTO in `packages/types`:** Zod-Schema fuer den simulierten Payment-Request/Response, klar als Fake gekennzeichnet, keine Persistenz der Zahlungsdaten.
- [x] **Worker-Sleep entfernen:** 1-s-Payment-Mock samt `sleep`-Dependency aus `handle-buy-ticket-message.ts` geloescht; der Worker ist jetzt reiner Persist-Consumer.
- [x] **Synchrone Pay-Route:** `POST /api/orders/:orderId/pay` validiert das DTO und published `BuyTicketEvent`, antwortet synchron mit `200` — kein Server-Sleep, keine DB-Writes.
- [x] **Publish-Rollback im Pay-Pfad:** Bei Publish-Fehler den Reservierungsanspruch atomar und idempotent freigeben. → [ADR-028](../../decisions/ADR-028-reserve-pay-publish-split-payment-latenz-lebt-im-frontend.md)
- [x] **Checkout-Abbruch/Timeout behandeln:** `POST /api/orders/:orderId/cancel` gibt die Ledger-Reservierung idempotent frei, sonst bliebe sie als Phantom-Anspruch stehen.
- [x] **Observability nachziehen:** E2E misst Publish→Persist; Checkout-Funnel und Abandon-Rate ergänzt.
- [x] **Tests:** Pay-Route (Happy/`404`/`409`/Rollback), Cancel-Route, Worker ohne Sleep und die E2E-Flows auf reserve→pay→Worker→Status umgestellt.
- [x] **ADR-028 + Doku-Lockstep:** ADR-028 angelegt, ADR-013/ADR-023 annotiert, `ARCHITECTURE.md` (Happy Path, Flow, Key-Lifecycle) und `REQUIREMENTS.md` (API-Surface) nachgezogen.

### Frontend: Checkout-Flow (`apps/web`)

- [x] **Auto-Fill Namen:** `apps/web/lib/names.ts` befuellt Vor-/Nachname beim Betreten der `open`-Phase mit Zufallsnamen, weiterhin editierbar.
- [x] **Payment-Modal:** Nach dem Reserve oeffnet `components/PaymentModal.tsx` (Tailwind-only) mit vorbefuellten Fake-Zahlungsdaten.
- [x] **Fake-3DS-Challenge:** Modal-Statemachine `form → challenge → processing`; erst „Bestätigen“ ruft `POST /pay`, Fehler landen als Banner im Kartenformular.
- [x] **Modal-Abbruch:** Schliessen des Modals (X/Abbrechen/Backdrop/Escape) gibt die Reservierung idempotent frei; `onPaid` loest **keinen** Cancel aus.
- [x] **Neue `tracking`-Phase:** `Phase`-Modell um `tracking` erweitert; nach bestaetigter Zahlung zeigt die neue `TrackingView` den Order-Status inline.
- [x] **Live-Order-Status:** `hooks/useOrderStatus.ts` pollt (2 s + Jitter) bis zum Final-Status; `TrackingView` rendert `pending`/`completed`/`failed` live.
