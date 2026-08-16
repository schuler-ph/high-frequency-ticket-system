# ADR-033: Abgelaufener Checkout ist ein eigener Endzustand

- **Status:** Teilweise umgesetzt
- **Datum:** 2026-08-16
- **Ergänzt:** ADR-031 (Ziffer 6 und 7 bleiben gültig, siehe Nachtrag dort)
- **Kontext:** ADR-031 hat den Pending-Reaper eingeführt: ein fälliger
  `pending`-Anspruch wird identitätsbasiert per `ZREM` + `INCR` freigegeben.
  Freigabe und Inventarrechnung sind damit korrekt, der Ablauf ist nach außen
  aber unsichtbar und im Pay-Pfad nicht durchgesetzt.

  Zwei konkrete Lücken. Erstens prüft `POST /orders/:orderId/pay` die Eligibility
  Deadline nicht: das Claim-Script wechselt `pending → publishing` allein anhand
  des Zustands. Wer nach Ablauf, aber vor dem nächsten Reaper-Zyklus zahlt,
  bekommt das Ticket trotzdem — bei 60-s-Zyklus ein Gnadenfenster von bis zu
  einer Minute. Die Korrektheit leidet nicht, weil die Lua-Guards eine doppelte
  Freigabe verhindern; ein Frontend-Timer würde aber lügen, und abgelehnte
  Zahlversuche hätten kein auswertbares Signal.

  Zweitens löscht der Reaper den Order-Record (`DEL orders:{orderId}`). Danach
  antworten Pay und Status-Poll mit einem generischen `404`, das für Client und
  Metriken nicht von „diese Order hat nie existiert" zu unterscheiden ist. Die
  Meldung „Reservierung abgelaufen", die das Frontend heute bei `404` zeigt, ist
  deshalb eine Vermutung und keine Information.

  Beides fällt erst auf, seit Phase 4.10 ein Lastprofil bauen will, das den
  Ablauf-Pfad überhaupt ausübt: mit `CHECKOUT_PENDING_TIMEOUT_SECONDS=900` und
  rund 6,5 Minuten Laufzeit konnte bisher nichts fällig werden.

- **Entscheidung:**
  1. **Die Deadline steht im Pending-Record, nicht nur im ZSet-Score.** Der Score
     bleibt die Autorität für die Reaper-Auswahl; der Record trägt denselben Wert
     als `expiresAt`, damit Checkout-Scripts und Status-Reads ihn ohne zweiten Key
     lesen können. Berechnet wird die Deadline genau einmal, in der Buy-Route;
     das Reserve-Script bekommt sie als Argument. Zwei getrennte Berechnungen
     könnten auseinanderlaufen.
  2. **`POST /pay` setzt die Deadline hart durch.** Die Prüfung liegt im
     `claimPayment`-Lua, nicht in der Route, damit es kein Fenster zwischen
     Prüfung und Zustandswechsel gibt. Die Grenze ist identisch mit der des
     Reapers (`deadline <= now` ist fällig): es darf keinen Moment geben, in dem
     Pay noch zusagt und der Reaper schon freigeben dürfte. Ein Record ohne
     `expiresAt` gilt als unbegrenzt, damit Reservierungen aus der Zeit vor
     diesem Feld bedienbar bleiben.
  3. **Ein abgelehnter Zahlversuch gibt niemals Inventar frei.** Der Anspruch
     bleibt im Ledger, bis der Reaper ihn regulär einsammelt. Die Pay-Route
     bleibt damit frei von Inventar-Schreibzugriffen außerhalb ihres eigenen
     Publish-Rollbacks.
  4. **`410 Gone` statt `404` für den Ablauf.** Der Client soll „abgelaufen" von
     „gab es nie" unterscheiden können. `404` bleibt der unbekannten `orderId`
     vorbehalten, `409` dem Zustandskonflikt.
  5. **Der Reaper hinterlässt einen `expired`-Grabstein statt zu löschen.** Der
     Record bekommt dieselbe Cleanup-TTL wie `completed|failed`
     (`REDIS_FINAL_ORDER_TTL_SECONDS`) und trägt die Deadline aus dem ZSet-Score.
     `expired` wird damit ein öffentlicher Order-Status neben `pending`,
     `completed` und `failed`; REQ-F05 lässt zusätzliche Zustände ausdrücklich
     zu. Die Freigabe selbst — `ZREM` + `INCR` — bleibt unverändert.
  6. **Ablehnungen werden eigenständig gezählt.**
     `payments_rejected_total{event_id, reason}` mit
     `reason ∈ {expired, not-found, conflict}`. Bisher waren Ablehnungen nur als
     Statuscode im HTTP-Histogramm sichtbar und nicht nach Ursache trennbar. Bei
     `not-found` gibt es keinen Record mehr, aus dem eine `event_id` zu lesen
     wäre; das Label fällt dann auf `unknown` zurück.

- **Begründung:**
  - Ein Timer, der abläuft, während die Zahlung noch durchgeht, ist schlechter
    als gar kein Timer: er erzeugt eine Erwartung, die das System nicht einhält.
  - Die Deadline im Script durchzusetzen statt in der Route ist dieselbe
    Überlegung wie beim Claim selbst (ADR-031 Ziffer 6): jede Prüfung außerhalb
    des atomaren Scripts eröffnet ein Check-then-act-Fenster.
  - Der Grabstein kostet einen `SET` mit TTL pro Ablauf und ersetzt einen `DEL` —
    kein zusätzlicher Roundtrip, keine zusätzliche Inventarwirkung. Dafür wird
    aus einem nicht unterscheidbaren `404` ein Endzustand, den Frontend, Report
    und Panel lesen können.
  - `expired` als Grabstein ändert die Capacity-Invariante nicht: der Anspruch
    ist zum Zeitpunkt des Schreibens bereits aus dem Ledger entfernt und
    `available` erhöht. Der Record ist ein Read-Model, kein Inventar.

- **Alternativen (verworfen):**
  - **Gnadenfenster behalten und den Timer als reine Anzeige deklarieren:**
    verlagert die Inkonsistenz in die UI-Erklärung statt sie zu beheben, und
    lässt das gewünschte Panel „Zahlversuche nach Ablauf" ohne sauberes Signal.
  - **Deadline in der Route prüfen statt im Script:** öffnet genau das
    Check-then-act-Fenster, das ADR-031 für den Claim schon geschlossen hat.
  - **Beim `DEL` bleiben und das Frontend aus dem `404` raten lassen:** ist der
    heutige Zustand; er macht Ablauf, Tippfehler in der `orderId` und einen
    Proxy-`404` ununterscheidbar.
  - **Pay lehnt ab UND gibt das Inventar sofort frei:** würde einen zweiten
    schreibenden Pfad auf das Inventar öffnen, den ADR-031 gerade beseitigt hat.
    Die Freigabe bleibt beim Reaper, auch wenn das den Anspruch bis zu einem
    Zyklus länger hält.
  - **TTL auf dem Pending-Record statt Grabstein:** ADR-031 Ziffer 7 hat das
    bereits verworfen — ein TTL-Ablauf entfernt einen Key, kompensiert aber
    nicht atomar Ledger und Counter.

- **Bewusst außerhalb des Scopes:** Recovery für hängende
  `publishing`-Zustände (unverändert offen aus ADR-031); ein eigener,
  vom `COUNT`-Zyklus entkoppelter Reaper-Intervall; die Frontend-Route mit
  Countdown. Letztere ist ein eigenes Todo derselben Phase.

- **Umsetzungsplan:** `docs/TODO.md` Phase 4.10, Todo 2; Detailplan in
  [`docs/notes/phases/phase-4-10-checkout-expiry.md`](../notes/phases/phase-4-10-checkout-expiry.md).
