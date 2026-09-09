# ADR-044: Arbeitsunfähigkeit ist ein 503, kein Schweigen

- Status: Fertig
- Datum: 2026-09-09

## Kontext

Am 2026-09-09 lief der Worker 13 Minuten lang, meldete `/health` durchgehend
mit 200 — und verarbeitete nichts. Sein Pub/Sub-Subscriber war vier Sekunden
nach dem Start mit `NOT_FOUND: Subscription does not exist` gestorben, weil das
Provisioning erst danach lief. Der Fehler wurde **einmal** geloggt, der
Streaming-Pull nie wieder aufgebaut. 1.000 Nachrichten blieben unzugestellt,
1.000 Reservierungen hingen im Checkout, „persistiert" stand auf 0.

Die API zeigte dasselbe Muster in der anderen Richtung: bei einem fehlenden
Topic beantwortete sie 26.680 Zahlungen mit 500 und `/health` weiter mit 200.

Beide Male war der Prozess dauerhaft arbeitsunfähig und meldete sich gesund. In
Kubernetes ist das der schlechteste Zustand: Liveness- und Readiness-Probe
halten den Pod im Dienst, kein Alarm schlägt an, der Durchsatz ist null.

## Entscheidung

Jeder Service hat einen einmaligen, nicht rücknehmbaren Zustand „dauerhaft
arbeitsunfähig" (`serviceHealth`, `markFatal(reason)`). Ist er gesetzt,
antwortet `/health` mit **503** und nennt den Grund im Body; der Vertrag dafür
steht in `@repo/types/health`.

Gesetzt wird er über eine Klassifizierung der Pub/Sub-Fehler nach
gRPC-Statuscode. `NOT_FOUND` (5), `PERMISSION_DENIED` (7) und `UNAUTHENTICATED`
(16) sind dauerhaft — die Ressource ist weg oder der Zugriff entzogen, kein
Retry repariert das. Alles andere (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, …) ist
transient und bleibt dem Retry des Clients überlassen.

- **Worker:** ein dauerhafter Fehler des Subscribers setzt den Zustand.
- **API:** ein dauerhafter Fehler beim Publish setzt ihn.

Die Reparatur ist der Neustart, und **der Prozess löst ihn selbst aus**: nach
`fastify.close()` beendet er sich mit Exit-Code 1. Darauf reagieren sowohl
Docker (`restart: unless-stopped`) als auch Kubernetes, beide mit wachsendem
Abstand zwischen den Versuchen. Der 503 bleibt daneben bestehen — für die
Sekunden bis zum Shutdown und für jede Probe, die in der Zeit fragt.

## Begründung

Ein Prozess, der seinen eigenen Defekt kennt, muss ihn nach außen sichtbar
machen — sonst ist er schlimmer als ein abgestürzter. Der Statuscode ist dafür
der richtige Kanal, weil ihn die Plattform ohne Logparsing auswertet.

Nicht rücknehmbar, weil die auslösenden Zustände solche sind, aus denen sich
der Prozess nicht heraussanieren kann: Die Subscription ist gelöscht, die
Rechte sind entzogen. Ein „vielleicht geht es wieder" würde den Neustart
verhindern, der die einzige Reparatur ist.

Der Grund steht im Body, damit er im Probe-Log landet und nicht erst im
Service-Log gesucht werden muss — genau die Suche, die diesen Vorfall 13
Minuten lang verzögert hat.

**Warum sich der Prozess beendet, statt nur zu melden.** Ein 503 ist ein
Bericht, keine Handlung; er wirkt erst, wenn ihn jemand abfragt _und_ daraus
eine Konsequenz zieht. Docker tut das nicht: `restart:` reagiert auf das
Prozess-Ende, und ein fehlgeschlagener `healthcheck:` markiert einen Container
nur als `unhealthy`, ohne ihn neu zu starten. Eine Liveness-Probe gibt es erst
in Kubernetes. Ein Prozess, der sich selbst beendet, braucht dagegen keinen
Akteur und verhält sich lokal wie in der Cloud gleich.

**Warum das auch für die API gilt.** Der erste Entwurf ließ die API nur melden,
mit dem Argument, ein fehlendes Topic breche nur die Zahlungen, während
Verfügbarkeit und Reservierung weiterliefen. Das hält nicht stand: `/buy`
reserviert dann Inventar, das keine Zahlung mehr einlösen kann — die API hält
Tickets fest und zeigt Nutzern einen Checkout, der garantiert scheitert. Das
ist kein Teilbetrieb, sondern ein kaputter Kauf-Funnel mit Nebenwirkung. Dass
alle Replicas gleichzeitig neu starten, ist kein Verlust: sie wären alle gleich
kaputt, und ein CrashLoopBackOff ist sichtbar, während N still 500ende Pods es
nicht sind.

## Alternativen

- **Existenzprüfung beim Boot** (`topic.exists()` / `subscription.exists()` im
  Plugin, Abbruch bei fehlender Ressource). War implementiert und wurde nach
  Messung wieder entfernt: Gegen den Emulator kostet der erste Aufruf ~3 s,
  weil die google-auth-Bibliothek zuerst den GCE-Metadata-Server abfragt (mit
  `GCE_METADATA_HOST` auf einen sofort scheiternden Wert: 79 ms). Mit
  Streuung überschritt der Aufruf Fastifys Plugin-Timeout von 10 s, und der
  Container startete **auch dann nicht, wenn alles in Ordnung war**. Damit
  tauscht man einen stillen Defekt gegen einen lauten Fehlalarm — ein
  schlechteres Geschäft. Die Prüfung bringt zudem wenig: der Worker meldet eine
  fehlende Subscription ohnehin binnen vier Sekunden über den Subscriber.
- **Nur melden, ohne sich zu beenden** (erster Entwurf): setzt einen Akteur
  voraus, den es lokal nicht gibt — siehe oben. Verworfen.
- **`process.exit()` ohne vorherigen Shutdown:** überspringt den geordneten
  Weg, den SIGTERM sonst nimmt. Deshalb erst `fastify.close()`, dann Exit. Die
  Testbarkeit bleibt über eine injizierbare `onFatal`-Option erhalten.
- **Eigener `/ready`-Endpunkt:** die übliche Trennung Liveness/Readiness. Für
  den Worker führt sie ins Leere — er nimmt keinen Verkehr entgegen, den man
  ihm entziehen könnte; der Neustart ist die Reparatur. Ein zweiter Endpunkt
  wäre zusätzliche Oberfläche ohne Wirkung. Sobald die API mehrere Replicas
  hinter dem Ingress hat (Phase 5.2), ist die Trennung neu zu bewerten.

## Konsequenzen

- Lokal genügt `restart: unless-stopped` in der `docker-compose.yml`: der
  Worker startet nach einem `docker compose up` ohne provisionierten Emulator
  in wachsenden Abständen neu, bis `pnpm seed` gelaufen ist, und hält dann.
- **Was die Kubernetes-Probes damit tun**, ist eine eigene Entscheidung, die
  mit den Manifesten fällt (Phase 5.1). Der Selbstabbruch deckt den Neustart
  bereits ab; eine `livenessProbe` auf `/health` wäre Redundanz, eine
  `readinessProbe` dagegen sinnvoll, um einen sterbenden API-Pod vor dem
  Shutdown aus der Rotation zu nehmen.
- `/health` hat jetzt zwei Antwortformen (200 `ok`, 503 `unhealthy` mit
  `reason`). Wer den Endpunkt als reinen Ping benutzt, muss den Statuscode
  auswerten, nicht nur die Erreichbarkeit — das gilt auch für
  `stack:wait-ready` und den Lasttest-Preflight.
- Der Zustand ist einmalig: nach `markFatal` hilft nur ein Neustart. Lokal
  heißt das `docker compose restart <service>`.
- Die Ursache der Reihenfolge bleibt bestehen. Ein Worker, der vor dem
  Provisioning startet, geht jetzt sichtbar in den Neustart-Zyklus statt still
  zu schweigen — verhindern lässt sich das nur durch einen
  Provisioning-Schritt, von dem API und Worker abhängen.
- Transiente Pub/Sub-Fehler werden weiterhin nur geloggt, jetzt aber
  ausdrücklich als solche benannt.
- **Redis bleibt ausdrücklich außen vor.** Beim Boot gilt dort schon
  Fail-fast über `REDIS_CONNECT_TIMEOUT_MS`. Zur Laufzeit verbindet ioredis
  sich selbst neu, und kurze Aussetzer sind normal — sie zu einem
  Prozessabbruch zu machen hieße, aus einem Schluckauf einen flottenweiten
  Neustartsturm zu machen, und zwar genau unter Last, wenn er am meisten
  schadet. Dauerhaft nicht erreichbares Redis bleibt damit vorerst ein
  unentdeckter Zustand; das zu erkennen bräuchte eine Schwelle
  ("seit N Sekunden getrennt") und ist offen.
