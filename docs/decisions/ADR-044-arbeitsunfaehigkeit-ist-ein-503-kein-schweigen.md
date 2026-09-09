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

Die Reparatur ist der Neustart, und auslösen soll ihn die **Liveness-Probe** auf
`/health`. Der Prozess beendet sich nicht selbst.

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
- **`process.exit()` statt 503:** überspringt den Graceful Shutdown und macht
  das Verhalten in Tests schwer greifbar. Der Neustart über die Probe ist
  derselbe, nur beobachtbar.
- **Eigener `/ready`-Endpunkt:** die übliche Trennung Liveness/Readiness. Für
  den Worker führt sie ins Leere — er nimmt keinen Verkehr entgegen, den man
  ihm entziehen könnte; der Neustart ist die Reparatur. Ein zweiter Endpunkt
  wäre zusätzliche Oberfläche ohne Wirkung. Sobald die API mehrere Replicas
  hinter dem Ingress hat (Phase 5.2), ist die Trennung neu zu bewerten.

## Konsequenzen

- **Die Liveness-Probe muss auf `/health` zeigen**, sonst hat die Entscheidung
  keine Wirkung. Das gehört in die Kubernetes-Manifeste von Phase 5.1.
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
