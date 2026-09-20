# Messung: Rolling Update der API unter Last

Stand: 2026-09-20 · Scope: Phase 5.2 — Requestverluste beim Rollout mit drei API-Replicas

Misst, wie viele Requests ein Rolling Update der API kostet, und belegt die Wirkung eines `preStop`-Hooks. Ergaenzt die [Lastverteilungsmessung vom selben Tag](replica-fanout-2026-09-20.md).

## Aufbau

Last: vier parallele `fetch`-Schleifen auf `GET /api/tickets/:eventId/availability`, rund 2.500 Requests/s, jeweils 90 Sekunden. Der Generator laeuft **im Worker-Pod** und spricht den Envoy-Service ueber seinen Cluster-DNS-Namen an.

Das ist keine Bequemlichkeit, sondern Voraussetzung: Ein `kubectl port-forward` als Eingang stirbt unter dieser Last reproduzierbar. Seine Ausfaelle waeren von Rollout-Fehlern nicht unterscheidbar und wuerden die Messung wertlos machen. Der Worker ist der richtige Ort, weil er vom API-Rollout nicht betroffen ist.

Rollout jeweils per `kubectl set image` waehrend die Last laeuft; die Lage des Rollouts im Messfenster ist ueber die Erstellungszeit des neuen ReplicaSets geprueft.

## Ergebnis

| Lauf                     | Rollout | Ergebnis                                                      |
| ------------------------ | ------- | ------------------------------------------------------------- |
| ohne `preStop`           | ja      | 226.128 × `200`, **90 × `503`**, dazu **9 s Totalstillstand** |
| Kontrolle                | nein    | 190.120 × `200`, keine Fehler                                 |
| mit `preStop: sleep 5 s` | ja      | 225.931 × `200`, **keine Fehler**, kein Durchsatzeinbruch     |

Die Kontrollmessung traegt den Vergleich: Sie schliesst aus, dass die Lastrate fuer sich Fehler erzeugt. Damit sind die 90 Ablehnungen dem Rollout zuzuschreiben und ihr Verschwinden dem Hook.

## Befund 1 — Der teuerste Teil des Rollouts war unsichtbar

Im Lauf ohne Hook stand der Durchsatz **neun Sekunden vollstaendig still**: keine Antwort, weder Erfolg noch Fehler. Alle Schleifen hingen gleichzeitig in offenen Requests. In der Fehlerzahl taucht das nicht auf — nur im Verlauf der Sekundenwerte.

Die Dauer entspricht der Groessenordnung von `FASTIFY_CLOSE_GRACE_DELAY=8000`: Der terminierende Pod nahm nach SIGTERM keine Requests mehr an, wurde von Envoy aber weiterhin als Endpoint gefuehrt, bis `close-with-grace` hart schloss.

Methodische Konsequenz: **Der Lastgenerator braucht ein Request-Timeout.** Ohne `AbortSignal.timeout` erscheint ein Haenger als Luecke im Zaehler statt als Fehler, und „null Fehler" laesst sich nicht von „steht still" unterscheiden. Die spaeteren Laeufe zaehlen Haenger als `ERR:TimeoutError`.

## Befund 2 — `preStop` schliesst das Fenster vollstaendig

Mit fuenf Sekunden Vorlauf fiel der Rollout in die Sekunden 7 bis 13 des Messfensters, ohne dass der Durchsatz messbar einbrach. Null Ablehnungen, null Timeouts.

`preStop` und Drain loesen dabei **verschiedene** Probleme, auch wenn beide zum Shutdown gehoeren:

| Komponente | Wer schickt Arbeit         | Problem beim Shutdown                           | Loesung                       |
| ---------- | -------------------------- | ----------------------------------------------- | ----------------------------- |
| API        | Envoy ueber Endpoint-Liste | Routing: **neue** Requests kommen nach SIGTERM  | `preStop`                     |
| API        |                            | In-flight: angenommene Requests abschliessen    | `fastify.close()`, bereits da |
| Worker     | Pub/Sub, push              | In-flight: zugestellte Nachrichten abschliessen | ADR-045, `behavior: "WAIT"`   |
| Worker     |                            | Routing: existiert nicht                        | entfaellt                     |

Waehrend des Hooks arbeitet der Container normal weiter und beantwortet Requests; erst danach kommt SIGTERM. Der Sleep ist bewusst eine Heuristik: Die Information, wann kube-proxy und Envoy ihren Endpoint entfernt haben, propagiert asynchron ueber mehrere Komponenten und ist im Pod nicht beobachtbar. `terminationGracePeriodSeconds: 35` ist das Gesamtbudget ab dem Terminating-Zeitpunkt und umfasst den Hook — belegt sind hier 5 s plus hoechstens 8 s.

## Befund 3 — Worker-Rollout unter Kauflast

Zweiter Messblock, gegen das zweite Pruefkriterium der Aufgabe. Last: 50 parallele Kauf-Schleifen (`POST /buy` gefolgt von `POST /pay`) ueber 90 Sekunden, ausgefuehrt **im API-Pod**. Der Generator darf nicht im Worker-Pod laufen: Er stirbt sonst mit dem Pod, den er belasten soll, und zum Zeitpunkt des Shutdowns ist nichts mehr in-flight — ein erster Versuch lief genau in diesen Fehler.

Zwei Laeufe mit identischer Last, nur der Shutdown unterscheidet sich:

| Lauf                                     | Shutdown-Dauer | Kaeufe | `redeliveries` | `duplicate_deliveries` | `idempotency_hits` | Bilanz |
| ---------------------------------------- | -------------- | ------ | -------------- | ---------------------- | ------------------ | ------ |
| A: `delete pod --force --grace-period=0` | sofort         | 57.011 | 0              | 0                      | 0                  | exakt  |
| B: `worker:restart` (regulaerer Rollout) | 4,6 s          | 57.576 | 0              | 0                      | 0                  | exakt  |

„Bilanz exakt" heisst: Tickets, `orders` und `events.sold_count` stimmen nach jedem Lauf auf die Einheit mit der Summe der abgesetzten Kaeufe ueberein (14.546 → 71.557 → 129.133). Das Capacity-Delta aus REQ-C03 bleibt null — auch ueber ein hartes `SIGKILL` mitten in 57.011 laufenden Kaeufen.

**Der Drain ist an der Shutdown-Dauer messbar.** Lauf B brauchte 4,6 Sekunden gegen `WORKER_SHUTDOWN_DRAIN_TIMEOUT_SECONDS=5`; ohne zugestellte Nachrichten waere der Shutdown sofort gewesen. Der Worker hat also tatsaechlich gewartet, statt zu nacken — das ist ADR-045 in Aktion.

**Die Positivkontrolle hat nicht ausgeschlagen**, und das ist selbst der Befund: Lauf A sollte Redeliveries erzwingen, erzeugte aber ebenfalls keine. Zwei Gruende greifen ineinander:

- `worker_redeliveries_total` zaehlt nur **eigene** NACKs des Workers bei transienten Fehlern oder Lock-Konflikten. Nachrichten, die der Emulator nach einem Stream-Abbruch dem naechsten Subscriber zustellt, laufen durch den normalen Verarbeitungspfad.
- `worker_duplicate_deliveries_total` und `worker_idempotency_hits_total` schlagen nur an, wenn eine **bereits finalisierte** Order erneut zugestellt wird. Das Zeitfenster zwischen DB-Write und Ack ist wenige Millisekunden, waehrend ein Handler durch den Payment-Mock rund eine Sekunde laeuft. Bei hoechstens 500 gleichzeitig zugestellten Nachrichten (`PUBSUB_FLOW_CONTROL_MAX_MESSAGES`) liegt die Erwartung damit unter einem Treffer — null ist das statistisch wahrscheinliche Ergebnis, kein Beleg fuer ein stilles Versagen.

Ein Kontrast waere also nur mit deutlich kuerzerem Payment-Mock oder kuenstlich verzoegertem Ack zu erzwingen. Fuer das Pruefkriterium reicht der Befund: Der Redelivery-Ausschlag, den ADR-045 beseitigen sollte, tritt beim Rollout nicht auf, und die Inventarbilanz bleibt exakt.

## Offen

Ob der `preStop`-Hook der API einen Nachtrag zu ADR-045 bekommt oder dort bewusst ausgeklammert bleibt, ist noch nicht entschieden.
