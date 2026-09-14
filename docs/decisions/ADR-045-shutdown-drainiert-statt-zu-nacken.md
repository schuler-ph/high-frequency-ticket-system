# ADR-045: Der Shutdown drainiert, statt zu nacken

- Status: Fertig
- Datum: 2026-09-14

## Kontext

Phase 5.2 stellt die API auf mehrere Replicas; ein Rolling Update wird damit
zum Normalfall statt zum Sonderfall. Der Worker war darauf nicht vorbereitet.

Sein `stop()` meldete erst alle Listener ab und rief dann
`subscription.close()`. Der Default dieser Methode ist
`SubscriberCloseBehaviors.NackImmediately`: alles, was bereits zugestellt und
noch nicht quittiert war, wird sofort genackt — auch die Nachricht, deren
Handler gerade zwischen `buy_ticket` und `ZREM` steht. Pub/Sub liefert sie
erneut aus, die Idempotenz absorbiert sie (ADR-023), und der Kauf ist korrekt.
Sichtbar wird es trotzdem: `worker_redeliveries_total` und
`worker_duplicate_deliveries_total` steigen bei jedem Deployment sprunghaft an.
Genau diese Kennzahl ist aber das Signal, an dem sich in der Cloud ein echtes
Zustellproblem zeigen soll — ein Deployment darf sie nicht selbst erzeugen.

Zwei weitere Details derselben Stelle:

- `removeAllListeners()` **vor** `close()` nahm auch den `message`-Listener ab.
  Er wird während des Drains gebraucht: er ist es, der die Nachrichten
  quittiert, auf deren Abschluss gewartet wird.
- Der `error`-Listener blieb dagegen hängen. `close()` zerstört den
  Streaming-Pull, und der Fehler, den er dabei meldet, lief in den
  Fatal-Pfad aus ADR-044 — `onFatal()` hätte den Prozess mitten im Drain per
  `process.exit(1)` beendet.

Dazu kommt die Abbruchkante eine Ebene höher: fastify-cli wartet nach SIGTERM
per `close-with-grace` nur **500 ms** auf `fastify.close()`, dann beendet es
hart. Jeder Drain, der länger dauert, wäre wirkungslos gewesen.

## Entscheidung

1. Die Subscription wird mit `closeOptions: { behavior: "WAIT", timeout }`
   erzeugt. `close()` lässt damit die laufenden Handler zu Ende kommen und
   nackt erst danach, was übrig ist.
2. Der Timeout ist eine Profil-Variable,
   `WORKER_SHUTDOWN_DRAIN_TIMEOUT_SECONDS` — lokal und in den Lastprofilen 5,
   in den Cloud-Profilen 25.
3. `stop()` meldet **nur** den `error`-Listener ab, und zwar vor `close()`.
   `removeAllListeners()` folgt erst danach.
4. `FASTIFY_CLOSE_GRACE_DELAY` ist ebenfalls eine Profil-Variable — lokal 8000,
   in den Cloud-Profilen 30000 — und steht im Zod-Schema, damit `debug:env` sie
   in jedem Profil erzwingt. Gelesen wird sie nicht von unserem Code, sondern
   von fastify-cli selbst (Präfix `FASTIFY_`).
5. Damit die CLI sie rechtzeitig sieht, startet der Prozess als
   `node --import @repo/env/preload node_modules/fastify-cli/cli.js start …`.
   Das neue Modul `@repo/env/preload` lädt nichts als das Profil und läuft, bevor
   `cli.js` importiert wird. Ohne diesen Vorlauf parst die CLI ihre Argumente,
   bevor `dist/app.js` und damit `@repo/env` überhaupt geladen sind — der
   Profil-Wert käme zu spät und fiele still auf den Default von 500 ms zurück.
   `CMD` und die `start`-Skripte haben deshalb dieselbe Form.

Die Werte bilden eine aufsteigende Kette, und jedes Glied muss unter dem
nächsten liegen:

```
WORKER_SHUTDOWN_DRAIN_TIMEOUT_SECONDS  <  FASTIFY_CLOSE_GRACE_DELAY  <  terminationGracePeriodSeconds
            5 s / 25 s                          8 s / 30 s                 (Manifest, Phase 5.1)
```

Lokal ersetzt das `docker stop`-Timeout (10 s) das letzte Glied — deshalb stehen
in den lokalen Profilen 5 s und 8 s statt 25 s und 30 s.

## Begründung

- **Die Library kann es bereits.** `WaitForProcessing` implementiert genau
  dieses Verhalten inklusive Nacken des Rests und Warten auf den Flush. Eine
  eigene In-flight-Zählung wäre dieselbe Logik ein zweites Mal, mit eigenen
  Fehlern.
- **Der Timeout gehört ins Profil, nicht in den Code.** Er muss zur
  Grace-Period der jeweiligen Umgebung passen, und die unterscheidet sich
  zwischen `docker stop` und einem Kubernetes-Manifest. Ein Literal wie in
  ADR-043 wäre hier falsch: das ist Deployment-Konfiguration.
- **Die Obergrenze ist eine Schranke, kein Warten.** Ein Shutdown ohne
  in-flight Nachrichten ist genauso schnell wie vorher.
- **Beide Glieder der Kette stehen nebeneinander im selben Profil.** Sie müssen
  zueinander passen; sie an zwei Orten zu pflegen wäre die verlässlichste Art,
  sie auseinanderlaufen zu lassen.

## Alternativen (verworfen)

- **Eigene In-flight-Verfolgung** (Set von Handler-Promises, `Promise.allSettled`
  mit Timeout): testbar mit den vorhandenen Attrappen, aber es dupliziert
  Library-Logik und deckt den Fall „zugestellt, aber noch nicht an den Handler
  übergeben" nicht ab.
- **`close-grace-delay` als CLI-Flag im `CMD`** oder als `ENV` im Dockerfile:
  beides funktioniert ohne Preload, backt den Wert aber ins Image. Dann trügen
  die beiden Hälften derselben Shutdown-Kette ihre Werte an zwei verschiedenen
  Orten, und ein Profilwechsel könnte nur noch die eine Hälfte verstellen —
  genau die zweite Wahrheit, die ADR-034 beseitigt hat.
- **Drain-Timeout als Konstante im Code:** verletzt die Kopplung an die
  Grace-Period der Umgebung und wäre der implizite Default, gegen den ADR-034
  steht.
- **Nichts tun und auf die Idempotenz vertrauen:** fachlich vertretbar (kein
  Ticket geht verloren), macht aber die Redelivery-Metrik als Frühwarnsignal
  unbrauchbar — und REQ-D02 verlangt, dass die Cloud-Duplikate _dauerhaft
  erwartet_ sind, nicht dass wir sie selbst erzeugen.

## Konsequenzen

- Der Phase-6-Punkt „Worker-Graceful-Shutdown mit Drain-Verhalten" ist damit
  erledigt und die in Phase 5.2 genannte Vorbedingung für Rolling Updates
  erfüllt.
- Das Kubernetes-Manifest (Phase 5.1) muss `terminationGracePeriodSeconds`
  über 30 setzen, sonst schneidet der kubelet die Kette ab. Ein `preStop`-Hook
  bleibt davon unberührt: er adressiert die Endpoint-Entfernung, nicht den
  Drain.
- Zwei Tests in `apps/worker/test/plugins/pubsub.test.ts` halten die
  Entscheidung fest (Drain-Konfiguration und der Fehler während des Shutdowns).
  Beide schlagen ohne die Änderung fehl.
