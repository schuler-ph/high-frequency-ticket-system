# Phase 4.10: Checkout-Expiry-Funnel

## Ziel

Der Pending-Reaper existiert seit Phase 4.9 und ist vollstaendig verdrahtet
(ADR-031), aber **kein Lasttest hat ihn je ausgeloest**. Mit
`CHECKOUT_PENDING_TIMEOUT_SECONDS=900` und rund 6,5 Minuten Laufzeit konnte in
Baseline D nichts faellig werden. Der Ablauf-Pfad ist ungetestet, nicht kaputt.

Phase 4.10 schliesst drei Luecken, ohne die ein Ablauf fuer Client und Metriken
unsichtbar bleibt, und ergaenzt ein Lastprofil, das den Pfad tatsaechlich
ausuebt:

1. Die Eligibility Deadline ist nirgends exponiert.
2. `POST /pay` kennt die Deadline nicht.
3. Der Reaper loescht den Order-Record, statt einen Endzustand zu hinterlassen.

Der eigentliche Beweis der Phase ist nicht Durchsatz, sondern **exakter
Sellout**: Abbrueche und Ablaeufe duerfen kein Inventar verlieren.

Herkunft der Ideen und die urspruengliche Bewertung stehen in
[checkout-expiry-funnel](../backlogs/checkout-expiry-funnel.md). Diese Notiz
entscheidet die dort offen markierten Annahmen und ersetzt die Gedanken-Notiz
nicht.

## Befundlage (2026-08-15 gegen den Code verifiziert)

### Bestaetigt

| Befund                                                                          | Beleg                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------ |
| Reaper-Lua macht `ZREM` + `INCR` + `DEL orders:{orderId}`                       | `apps/worker/src/lib/redis-scripts.ts:103-108`   |
| Nicht freigabefaehige Kandidaten werden quarantaeniert, nicht geloescht         | ebd. `:81-101`, `ZADD` auf `MAX_SAFE_INTEGER`    |
| `/pay` prueft keine Deadline, kein `ZSCORE` im Pfad                             | `apps/api/src/routes/api/orders/pay.ts:77-95`    |
| Deadline entsteht im Reserve-Lua und lebt nur im ZSet-Score                     | `apps/api/src/lib/redis-scripts.ts:33-34`        |
| Der Pending-Record hat weder `expiresAt` noch TTL                               | `apps/api/src/routes/api/tickets/buy.ts:62-68`   |
| Kein `expired`-Zustand; Status klappt `publishing`/`paid` auf `pending` zurueck | `apps/api/src/routes/api/orders/status.ts:22-28` |
| `payments_rejected_total` existiert nicht                                       | keine Fundstelle in `apps/`, `packages/`         |

### Korrekturen gegenueber der Gedanken-Notiz

Vier Punkte, die beim Umsetzen sonst ueberraschen:

1. **Die Reaper-Panels existieren bereits.** `Inventory Integrity` plottet
   candidates, releases, skips und oldest_age in Panel 11 und 12
   (`monitoring/grafana/provisioning/dashboards/reservation-consistency.json:626,692`).
   Offen ist nur `reservation_reaper_run_duration_seconds` — die einzige
   Reaper-Metrik, die in keinem Dashboard vorkommt.
2. **Verdict-Checks liegen nicht in `scripts/local/run-spike.mjs`.** Es gibt zwei
   Orchestratoren: `pnpm spike` macht ausschliesslich Plateau-Erkennung, ohne
   Drain und ohne Verdict. Die fuenf Invarianten stehen in
   `scripts/load-test/lib/derive.mjs:220-279`, die Verdicts in `validate.mjs`,
   die Sold-out-Erkennung des Report-Pfads in `processes.mjs:122`.
3. **`CHECKOUT_PENDING_TIMEOUT_SECONDS` ist Service-Env**
   (`packages/env/src/index.ts:37`). Am Spike-Prozess gesetzt landet der Wert im
   Manifest, erreicht die laufenden API- und Worker-Prozesse aber nicht. Beides
   kann auseinanderlaufen und den Report still falsch beschriften.
4. **Der Reaper-Batch-Deckel fehlt in der Notiz vollstaendig.**
   `WORKER_RESERVATION_REAPER_BATCH_SIZE=1000` gilt pro Event **pro Zyklus**; bei
   60-s-Zyklus sind das rund 16,7 Freigaben pro Sekunde. Bei 150 Checkouts/s und
   etwa 10 Prozent Ablauf entstehen rund 900 Freigaben pro Zyklus, also knapp
   unter dem Deckel. Jede Erhoehung von σ laesst den Ledger-Rueckstau anwachsen,
   und der exakte Sellout konvergiert nicht mehr.

Ergaenzend: Der Reaper ist Redis-only. `reapPendingReservations` nutzt vom
DB-Snapshot ausschliesslich `snapshot.eventId`
(`apps/worker/src/lib/pending-reservation-reaper.ts:77-99`) und arbeitet danach
mit `zcount`, `zrangebyscore` und Lua. Ein eigener, kuerzerer Reaper-Intervall
kostet null zusaetzliche `COUNT(tickets)`. ADR-031 Ziffer 4 argumentiert gegen
haeufigere DB-Snapshots, nicht gegen haeufigeres Reapen.

## Sizing: warum 100k und nicht 1M

Es gilt Little's Law: **gleichzeitige VUs = Checkout-Rate mal mittlere
Denkzeit.** Ein VU ist kein Nutzer pro Sekunde, sondern ein Platzhalter, der
belegt ist, solange eine Iteration laeuft — die Denkzeit ist Teil dieser Dauer.
Das k6-Skript sagt dasselbe bereits im Kommentar zu `maxVUs`
(`load-tests/spike-phase-a.js:11-16`).

Die „150 Checkouts pro Sekunde" der Gedanken-Notiz sind daraus rueckwaerts
gerechnet: `maxVUs 10000 / 60 s ist rund 167`. Das ist eine Budgetrechnung, keine
Systemgrenze — das `capacity`-Profil faehrt gegen dieselbe API 10.000 Iterationen
pro Sekunde.

| Kapazitaet | Ziel-Laufzeit | noetige Rate      | erlaubte Denkzeit bei 10k VUs |
| ---------- | ------------- | ----------------- | ----------------------------- |
| 100k       | rund 11 min   | 150 Checkouts/s   | 60 s                          |
| 1M         | rund 15 min   | 1.111 Checkouts/s | 9 s                           |
| 1M         | rund 60 min   | 278 Checkouts/s   | 36 s, aber unbrauchbar lang   |

1M mit realistischer Denkzeit braucht rund 66.000 VUs. Das scheitert an drei
unabhaengigen Grenzen: Arbeitsspeicher (k6 belegt 1 bis 5 MB pro VU, also 66 bis
330 GB), der Ephemeral-Port-Grenze einer Quell-IP (rund 64k gleichzeitige
Verbindungen zu einem Ziel) und den offenen Keep-alive-Sockets am SUT. CPU ist
dabei irrelevant, denn schlafende VUs sind geparkte Goroutines.

Wichtig fuer die Einordnung: **Durchsatzziel und Denkzeit sind zwei verschiedene
Tests und duerfen nicht multipliziert werden.** Dieselbe Rate ohne Denkzeit
braucht nur wenige tausend VUs; genau deshalb deckt `maxVUs 10000` heute die
10k-Zielrate ab. Der Generator-SUT-Split aus Phase 4.12 aendert an dieser
Rechnung nichts, er entkoppelt nur CPU und Netzwerk von Generator und SUT.

Der 1-M-Kapazitaetsbeweis bleibt deshalb beim `capacity`-Profil.
`compare.mjs:39-53` blockt Vergleiche ueber Kapazitaets- und Profilgrenzen
ohnehin.

## Entschiedene Annahmen (2026-08-16)

| #   | Frage                     | Entscheidung                                                                   |
| --- | ------------------------- | ------------------------------------------------------------------------------ |
| A   | Scope Phase 4.10          | Erst schneiden; Umsetzung als einzelne Todos in der Reihenfolge unten          |
| B   | `/pay` nach Deadline      | Hart ablehnen mit 410 Gone, Deadline im `claimPayment`-Lua durchgesetzt        |
| C   | Reap-Verhalten            | `expired`-Grabstein mit `REDIS_FINAL_ORDER_TTL_SECONDS` statt `DEL`            |
| D   | Funnel-Kapazitaet         | 100k mit 60 s Denkzeit; 1M komprimiert als eigenes Todo am Phasenende          |
| E   | Mix Availability/Checkout | Read-Last entkoppeln statt 50/50: kleiner Checkout-Anteil, hohe Iterationsrate |
| F   | σ der Denkzeit            | Beim Profilbau gegen den Reaper-Batch-Deckel rechnen, nicht vorab fixieren     |

**Zu B:** ohne Enforcement wuerde der Frontend-Timer luegen — eine Zahlung nach
Ablauf geht bis zum naechsten Reaper-Zyklus noch durch, also bis zu rund 60
Sekunden lang. Korrektheit gefaehrdet das nicht, weil die Lua-Guards eine
Doppel-Freigabe verhindern, aber das Panel „Zahlversuche nach Ablauf" haette kein
sauberes Signal.

**Zu C:** nach `DEL` liefern sowohl `/pay` als auch der Status-Poll ein
generisches 404, fuer Client und Metriken ununterscheidbar von einer nie
existierenden Order. REQ-F05 verlangt „mindestens `pending`, `completed`,
`failed`" und laesst zusaetzliche Zustaende ausdruecklich zu. Die Freigabe selbst
bleibt identisch, es kommt nur der Grabstein dazu.

**Zu E:** bei fixem 50/50-Mix faehrt der Funnel-Lauf mit rund 450 RPS und sieht
auf den API-Dashboards wie Leerlauf aus. Die Availability-Reads sind VU-billig,
weil sie nicht schlafen; die Checkouts sind VU-teuer. Bei etwa 5 Prozent
Checkout-Anteil und 3.000 Iterationen pro Sekunde ergeben sich rund 150
Checkouts pro Sekunde bei rund 9.000 VUs, dazu rund 2.850 RPS echter Read-Last.
Damit steht der SUT unter realistischer Last, ohne das VU-Budget zu sprengen.

**Zu F:** die Gedanken-Notiz schlaegt σ von rund 35 s vor, was etwa 4 bis 5
Prozent Zu-spaet-Zahler ergibt. Der Wert wird beim Bau des Profils gegen den
Reaper-Batch-Deckel gerechnet und nicht vorab fixiert, weil beide Groessen
voneinander abhaengen.

## Schnitt

Die Todos stehen in [`docs/TODO.md`](../../TODO.md) unter Phase 4.10 in dieser
Reihenfolge. Die ersten beiden sind Vorbedingung fuer alles Weitere; Frontend,
k6-Profil und Panels sind danach unabhaengig voneinander.

1. **Vertrag `expiresAt` exponieren.** Deadline zusaetzlich in den
   Pending-Record, in die Buy-Response und in die Status-Response fuer `pending`,
   dazu Serverzeit oder `remainingSeconds` gegen Client-Clock-Skew. Rein additiv,
   kein Verhaltenswechsel. Beruehrt `packages/types/src/tickets.ts`, das
   Reserve-Lua in `apps/api/src/lib/redis-scripts.ts`,
   `apps/api/src/routes/api/tickets/buy.ts` und `.../orders/status.ts`.
2. **ADR und Ablauf-Semantik.** `expired`-Grabstein statt `DEL` im Reaper-Lua,
   Deadline-Enforcement im `claimPayment`-Lua, neuer typed Error 410 neben dem
   bestehenden 425-Muster in `packages/types/src/errors.ts`, neue Metrik
   `payments_rejected_total{reason}`. Dazu ein ADR, der ADR-031 ergaenzt und
   nicht abloest, plus datierter Nachtrag in ADR-031 Ziffer 6 und 7. REQ-F03 und
   REQ-F05 in `docs/REQUIREMENTS.md` nachziehen; `docs/ARCHITECTURE.md`
   Abschnitt 5 und die Redis-Schluessel-Tabelle ebenfalls, dort steht ausserdem
   eine doppelte Kopfzeile.
3. **Frontend `/checkout/[orderId]`.** Eigene App-Router-Route, Countdown aus
   `expiresAt`, terminaler `expired`-Zustand. `apps/web` hat heute nur `/` und
   haelt den Order-State ausschliesslich im React-State
   (`apps/web/app/page.tsx:155,297`), daher ist die Route der groesste
   Einzelbaustein der Phase. Damit entfaellt der 404-Rateschluss in
   `apps/web/lib/api.ts:68-70`, und das `PaymentModal` darf bei `expired` nicht
   mehr ins Kartenformular zurueckfallen
   (`apps/web/components/PaymentModal.tsx:88-89`).
4. **k6-Profil `funnel`.** Vierter `LOAD_PROFILE`. Dafuer muss
   `load-tests/lib/scenario-helpers.js` von drei verstreuten `if`-Zweigen auf
   eine Profiltabelle umgestellt werden: das Mix-Literal `0.4` (`:275`) und der
   `LOAD_PROFILE !== "realism"`-Guard in `thinkTime()` (`:239`) sind nicht
   parametrisiert. Truncated Normal per Box-Muller, weil k6 kein `randn` hat.
   Neue Counter `funnel_pay_expired_attempt` und `funnel_pay_rejected`; ihre
   Differenz zeigt das Gnadenfenster beziehungsweise nach Entscheidung B dessen
   Abwesenheit. Neue Env-Knoepfe in `CONFIG_ALLOWLIST`
   (`scripts/load-test/lib/manifest.mjs:16-34`) eintragen, sonst fehlen sie im
   Manifest; Profil-Enum in `.vscode/tasks.json` und `load-tests/README.md`
   nachziehen.
5. **Reaper-Dimensionierung fuer das Profil.** Batch-Groesse und Zyklus gegen die
   erwartete Ablaufrate rechnen und als Profil-Env festlegen; hier faellt auch σ.
   Ohne das staut der Ledger auf und `sold == totalCapacity` konvergiert nicht.
6. **Lasttest-Stack-Env.** `CHECKOUT_PENDING_TIMEOUT_SECONDS=120` und
   `SEED_CAPACITY=100000` dort setzen, wo API und Worker starten, nicht am
   Spike-Prozess. Die Defaults 900 und 1.000.000 bleiben unveraendert.
7. **Abbruchbedingung und Verdict.** Sold-out-Erkennung im Report-Pfad
   (`scripts/load-test/lib/processes.mjs:122`) fuer das Funnel-Profil erweitern:
   Abbruch erst, wenn `available == 0` **und** `reservation_ledger_active == 0`,
   danach Drain. Neue Checks in `derive.mjs` und `validate.mjs`:
   `sold == totalCapacity` als Kernbeweis,
   `reservation_reaper_releases_total > 0`, sonst ist der Lauf fuer diese Frage
   inconclusive, und `payments_rejected_total{reason="expired"} > 0`. Die
   Capacity-Invariante aus REQ-C03 bleibt unveraendert.
8. **Panels ergaenzen.** Serie „Pay Rejected (expired)" im Order Lifecycle neben
   Confirmed und Cancelled; die Abandon-Rate-Formel
   (`order-lifecycle.json:445`) um Expired erweitern, sonst zaehlen Ablaeufe
   stumm als Abandon. Reaper-Panels existieren bereits, offen ist nur
   `reservation_reaper_run_duration_seconds`.
9. **Funnel-Lauf fahren.** Nur mit ausdruecklicher, laufbezogener Freigabe
   (Repo-Regel). Kommandos: `LOAD_PROFILE=funnel pnpm spike`, Auswertung
   `pnpm spike:report`.
10. **Optional: 1M mit komprimierter Zeit.** Denkzeit rund 6 s, Deadline rund
    12 s, Reaper-Intervall vom `COUNT`-Zyklus entkoppelt. Erst sinnvoll, wenn die
    100k-Variante den Pfad bewiesen hat.

## Erwartungsbild

Die transienten Treppen im Capacity Delta bleiben, weil der
Cross-System-Snapshot nicht atomar ist; der Reaper aendert daran nichts. Neu
sichtbar wird ein `reservation_ledger_stale`-Aufbau vor jedem Reaper-Zyklus und
dessen Abbau danach. Das ist das beste Live-Signal dafuer, dass der Reaper
ueberhaupt arbeitet.
