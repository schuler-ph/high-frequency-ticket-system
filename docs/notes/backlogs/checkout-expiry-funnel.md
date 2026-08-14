# Checkout-Expiry-Funnel: Timer, 2-min-Deadline und Sellout-Lastprofil

Ideensammlung und Bewertung (2026-08-14) zu Philipps Vorschlag: Reservierungs-
Timer im Frontend, 2-Minuten-Checkout-Fenster, neues Lastprofil mit
normalverteilter Checkout-Denkzeit und sichtbaren Zahlversuchen nach Ablauf.
Noch keine Entscheidung und keine Umsetzung; Entscheidungsbedarf ist unten
explizit markiert.

## 1. Bewertung der Ausgangsthese („für exakt 1M sold brauchen wir nur noch den Reaper")

Die These stimmt in der Richtung, aber der Reaper **existiert bereits** und ist
verdrahtet (ADR-031, `apps/worker/src/lib/pending-reservation-reaper.ts`,
Lua `reapPendingReservation` in `apps/worker/src/lib/redis-scripts.ts`, Zyklus
`WORKER_INVENTORY_CYCLE_INTERVAL_SECONDS=60`, Batch
`WORKER_RESERVATION_REAPER_BATCH_SIZE=1000`, Metriken `reservation_reaper_*`).
Was fehlt, ist kein Mechanismus, sondern ein Lastprofil, das ihn auslöst: mit
`CHECKOUT_PENDING_TIMEOUT_SECONDS=900` bei ~6,5 min Laufzeit konnte in
Baseline D nichts fällig werden — der Pfad ist ungetestet, nicht kaputt.

Für „exakt Kapazität verkauft, jedes Mal" braucht es vier Dinge:

1. **Freigabe abgelaufener Ansprüche** — vorhanden (Reaper).
2. **Nachfrage-Überhang bis zum Schluss (Tail-Problem):** Gibt der Reaper die
   letzten abgelaufenen Ansprüche frei, nachdem alle k6-VUs fertig sind, bleibt
   das freigewordene Inventar unverkauft. Das Profil muss weiterkaufen, bis
   `available == 0` **und** das Ledger leer ist, nicht bis eine feste Dauer
   abgelaufen ist.
3. **Laufzeit-Puffer:** letzter möglicher Ablauf + bis zu ein voller
   Reaper-Zyklus (60 s) + Wiederverkauf + Worker-Drain. Der Reaper gibt „nie
   vorher und im nächsten Lauf danach" frei (ADR-031 Ziffer 7) — bei 120 s
   Deadline ist ein Anspruch also im Mittel ~30 s, maximal ~60 s nach Ablauf
   wieder verfügbar.
4. **Neuer Verdict-Check:** heute prüft der Lasttest Capacity-Delta == 0 nach
   Drain (REQ-C03). „Exakter Sellout" ist ein zusätzlicher Check
   `sold == totalCapacity`, den nur dieses Profil verlangt — im
   `capacity`-Profil ist er trivial erfüllt, im Funnel-Profil ist er der
   eigentliche Beweis, dass Abbrüche und Abläufe nichts verlieren.

## 2. Semantik-Lücken, die vor dem Profil entschieden werden müssen

### 2.1 `/pay` prüft die Deadline nicht

`confirmPayment` claimt `pending → publishing` ohne Blick auf die Eligibility
Deadline (`apps/api/src/routes/api/orders/pay.ts`). Wer nach Ablauf, aber vor
dem nächsten Reaper-Zyklus zahlt, bekommt das Ticket noch — bis zu ~60 s
„Gnadenfenster". Korrektheit gefährdet das nicht (Lua-Guards verhindern
Doppel-Freigabe), aber der Frontend-Timer würde lügen („abgelaufen", Zahlung
geht trotzdem durch), und das gewünschte Panel „Zahlversuche nach Ablauf" hätte
kein sauberes Signal.

**Empfehlung:** Deadline im `claimPayment`-Lua durchsetzen. Dafür muss die
Deadline im Pending-Record selbst stehen (heute lebt sie nur im ZSet-Score),
siehe 3.1 — dann braucht das Script keinen zweiten Key. Neuer Return-Code →
typed Error (410 Gone bietet sich an, analog zum bestehenden 425-Muster in
`packages/types/src/errors.ts`).

### 2.2 Der Reaper löscht den Order-Record

`reapPendingReservation` macht `ZREM + INCR + DEL orders:{orderId}`. Danach
liefert `/pay` ein generisches `404 Reservation not found` und der Status-Poll
ebenfalls 404 — für Client und Metriken ununterscheidbar von einer nie
existierenden Order. Das Frontend kann kein „Reservierung abgelaufen" rendern,
und die Web-Fehlermeldung „Reservierung abgelaufen" bei 404
(`apps/web/lib/api.ts`) ist heute eine Vermutung, keine Information.

**Empfehlung:** Statt `DEL` einen terminalen `expired`-Record mit TTL setzen
(wie `completed|failed`, `REDIS_FINAL_ORDER_TTL_SECONDS`). Dann: Status-Route
zeigt `expired`, `/pay` auf `expired` → klarer Fehler statt 404, Frontend hat
einen ehrlichen Endzustand. Das ändert ADR-031 Ziffer 6 im Detail (Freigabe
bleibt identisch, nur der Grabstein kommt dazu) → **eigene Mini-ADR nötig**,
zusammen mit 2.1.

### 2.3 Abgelehnte Zahlversuche haben keine Metrik

Es gibt nur `payments_confirmed_total` und `publish_rollbacks_total`;
Ablehnungen sind nur im HTTP-Histogramm als `status_code=404|409` sichtbar.
**Empfehlung:** `payments_rejected_total{reason="expired"|"not-found"|"conflict"}`
in der Pay-Route — genau die Serie, die das gewünschte Panel braucht.

## 3. Vertrag und Frontend

### 3.1 `expiresAt` exponieren

Die Deadline entsteht beim Reserve (`now + CHECKOUT_PENDING_TIMEOUT_SECONDS`)
und lebt nur im ZSet-Score. Für Timer und Deadline-Enforcement gehört sie
zusätzlich (a) in den Pending-Record (`pendingOrderCacheEntrySchema`), (b) in
die Buy-Response (`buyTicketResponseSchema`) und (c) in die Status-Response für
`pending`. Gegen Client-Clock-Skew sollte die Response neben `expiresAt` auch
die Serverzeit (oder `remainingSeconds`) liefern; der Client rechnet nur die
Differenz weiter.

### 3.2 URL vor localStorage

`/checkout/[orderId]` als eigene App-Router-Route ist das robustere Medium:
reload-fest, teilbar, kein Storage-Sync — Status und Restzeit kommen bei jedem
Aufruf frisch aus `GET /api/orders/:orderId` (Redis-Read-Model, passt zur
Systemregel). `orderId` ist eine nicht ratbare UUID, die URL enthält nichts
Sensibles. localStorage nur als Komfort obendrauf („du hast eine aktive
Reservierung" → Redirect-Hinweis auf der Startseite), nicht als Quelle der
Wahrheit. Heute hat `apps/web` nur `/` und hält Order-State ausschließlich im
React-State — die Route ist der größte Frontend-Baustein.

### 3.3 Timer-UX

Countdown aus `expiresAt` (Anzeige mm:ss, unter ~30 s optisch warnen). Bei 0
kippt die Seite in einen `expired`-Zustand; ein trotzdem abgesetzter
Pay-Versuch (Race: Timer lief ab, Request war schon unterwegs) bekommt nach
2.1/2.2 eine klare 410/„expired"-Antwort statt 404. Das bestehende
`PaymentModal` (fake-3DS) bleibt unverändert; der Cancel-on-close-Pfad
existiert schon.

## 4. Lastprofil `funnel` (viertes `LOAD_PROFILE`)

Die Basis existiert in `load-tests/lib/scenario-helpers.js`: Profile
`capacity|realism|checkout`, `PAY_RATE=0.88`, `CANCEL_RATE=0.08`, Rest Abandon,
Think-Time uniform 2–8 s, Mix 60 % Availability / 40 % Checkout. Neues Profil:

- **Mix 50/50** Availability-Reads vs. Checkout-Funnel (profilabhängige
  Konstante statt der heutigen 0,4).
- **Denkzeit truncated Normal:** µ = 60 s, σ ≈ 35 s, geklemmt auf [10 s, 180 s]
  (Box-Muller im k6-Skript; k6 hat kein `randn`). Mit Deadline 120 s ergibt
  σ = 35 s ≈ 4–5 % natürliche Zu-spät-Zahler — genug für ein sichtbares
  Panel-Signal, ohne den Sellout zu dominieren. σ ist der Stellhebel, falls
  mehr Reaper-Traffic gewünscht ist (σ = 45 s → ~9 %).
- **Kohorten:** ~90 % zahlen (davon zahlen die Zu-spät-Zahler bewusst
  _trotzdem_ — genau das erzeugt die Rejected-Serie), ~5 % Cancel (explizit),
  ~5 % stiller Abbruch ohne Cancel (Reaper-Futter, gibt es als
  `funnel_abandoned` schon).
- **Deadline:** `CHECKOUT_PENDING_TIMEOUT_SECONDS=120` nur im
  Lasttest-Stack-Env dieses Profils; der Default 900 bleibt.
- **Reaper-Granularität:** Zyklus 60 s bei Deadline 120 s heißt Freigabe im
  Mittel +30 s nach Ablauf. Das ist akzeptabel und bewusst nicht „getunt" —
  ADR-031 lehnt einen Peak-Modus für den Zyklus ab, weil jede Verdichtung nur
  DB-Last (COUNT-Snapshot) kostet und keine Korrektheit bringt. Erst messen,
  dann ggf. den Reaper vom Snapshot-Zyklus entkoppeln.

### 4.1 Sizing: Denkzeit bindet VUs

Jede Checkout-Iteration schläft im Mittel ~60 s und belegt dabei einen VU:
gehaltene Reservierungen ≈ Checkout-Rate × E[Denkzeit]. Bei 1 M Kapazität und
z. B. 1.100 Checkouts/s (Sellout in ~15 min) wären das ~66.000 gleichzeitig
schlafende VUs — weit über dem heutigen `maxVUs 10000` und für k6-Prozesse
unrealistisch schwer. Optionen:

- **(a) Kapazität fürs Funnel-Profil senken** (z. B. 100 k Tickets): bei
  ~150 Checkouts/s ≈ 9 k parallele VUs, Sellout in ~13 min. **Empfohlen** —
  das Funnel-Profil beweist Korrektheit unter Ablauf/Reaper, nicht Durchsatz;
  der 1-M-Kapazitätsbeweis bleibt beim `capacity`-Profil. Manifest/Profil
  verhindern ohnehin Vergleiche über Profilgrenzen.
- (b) Zeitkompression (alles ÷10: µ = 6 s, Deadline 12 s): verzerrt das
  Verhältnis zum 60-s-Reaper-Zyklus massiv (fast jeder Ablauf würde erst
  lange nach der Deadline gereapt) — nur sinnvoll, wenn der Zyklus mitschrumpft,
  was 4. widerspricht.
- (c) 1 M bei niedriger Rate: >2 h Laufzeit, unpraktisch für Iteration.

### 4.2 Sellout-Steuerung und Verdict

`scripts/local/run-spike.mjs` erkennt heute Plateau/Soldout über
`orders_completed_total` und Availability. Fürs Funnel-Profil erweitern:
Abbruchbedingung erst, wenn `available == 0` **und** `reservation_ledger_active
== 0` (Ledger leer), dann Drain. Neue Verdict-Checks:

- `sold == totalCapacity` (exakter Sellout, Kernbeweis dieses Profils),
- `reservation_reaper_releases_total > 0` (der Pfad wurde wirklich ausgeübt —
  sonst ist der Run für diese Frage inconclusive),
- `payments_rejected_total{reason="expired"} > 0`,
- Capacity-Delta == 0 nach Drain (unverändert, REQ-C03).

### 4.3 k6-Metriken

Ergänzend zu `funnel_reserved/paid/cancelled/abandoned`:
`funnel_pay_expired_attempt` (Versuch nach lokal abgelaufenem Timer) und
`funnel_pay_rejected` (Server hat abgelehnt) — die Differenz der beiden zeigt
das Gnadenfenster bzw. nach 2.1 dessen Abwesenheit.

## 5. Panels

- **Inventory Integrity:** Reaper-Serien existieren
  (`reservation_reaper_candidates/releases_total/skips_total/oldest_age_seconds`);
  prüfen, ob das Dashboard sie schon plottet (ADR-031 §8 verlangt es), sonst
  Panel „Reaper Activity" ergänzen.
- **Order Lifecycle:** neue Serie „Pay Rejected (expired)" aus
  `payments_rejected_total{reason="expired"}` neben Confirmed/Cancelled; die
  Abandon-Rate-Formel um Expired erweitern (sonst zählen Expiries stumm als
  Abandon).
- **Erwartungsbild Capacity Delta:** Die transienten Treppen bleiben (nicht
  atomarer Cross-System-Snapshot); der Reaper ändert daran nichts. Neu
  hinzu kommt sichtbarer `reservation_ledger_stale`-Aufbau vor jedem
  Reaper-Zyklus und dessen Abbau danach — ein gutes Live-Signal, dass der
  Reaper arbeitet.

## 6. Vorgeschlagene Umsetzungsreihenfolge (klein geschnitten)

1. **Vertrag:** `expiresAt` in Pending-Record, Buy-Response und
   Status-Response (+ Tests). Rein additiv, kein Verhaltensänderung.
2. **ADR + Semantik:** `expired`-Terminal-Record statt `DEL` im Reaper-Lua,
   Deadline-Enforcement in `claimPayment`, `payments_rejected_total` (2.1–2.3).
3. **Frontend:** `/checkout/[orderId]`-Route mit Timer und `expired`-Zustand;
   localStorage-Komfort optional danach.
4. **k6:** Profil `funnel` (Mix, truncated Normal, Kohorten), Env-Overrides,
   `run-spike.mjs`-Abbruchbedingung, Verdict-Checks.
5. **Panels:** Serien aus 5. ergänzen.
6. **Lasttest:** erst nach ausdrücklicher Freigabe (Repo-Regel). Kommandos:
   `pnpm spike` mit `LOAD_PROFILE=funnel`, Auswertung `pnpm spike:report`.

## 7. Getroffene Annahmen (bitte bestätigen oder kippen)

- **Kapazität im Funnel-Profil 100 k statt 1 M** (4.1a) — sonst VU-Problem.
- **σ = 35 s** für die Denkzeit → ~4–5 % Zu-spät-Zahler.
- **`/pay` lehnt nach Deadline hart ab** (kein Gnadenfenster) — nötig für
  ehrlichen Timer und sauberes Panel.
- **`expired` wird öffentlicher Order-Status** mit TTL wie finale Orders.
