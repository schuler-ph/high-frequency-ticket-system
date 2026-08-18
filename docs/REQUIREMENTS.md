# Systemanforderungen

Diese Datei definiert, **was** das Ticket-System leisten und nachweisbar
einhalten soll. Sie enthält keine Technologiebegründungen und keinen
Umsetzungsstatus. Das aktuelle Design steht in `docs/ARCHITECTURE.md`,
Begründungen im ADR-Index `docs/DECISIONS.md` und offene Umsetzung in
`docs/TODO.md`.

## Produkt und Scope

Das System simuliert den Verkauf von einer Million General-Admission-Tickets
für das Frequency Festival in St. Pölten. Es soll einen realistischen
Sale-Lifecycle mit Vorverkaufsphase, plötzlicher Lastspitze, Checkout,
Ausverkauf und anschließendem Drain demonstrieren.

Nicht Teil des Scopes sind echte Authentifizierung, ein echter Payment-Provider,
Ticket-Preislogik und vollständige Disaster-Recovery nach Verlust des
Live-Inventars. Käufer nutzen einen Guest Checkout; Payment und 3DS werden
deterministisch simuliert.

## Funktionale Anforderungen

### REQ-F01 — Verfügbarkeit

Clients können für ein Event die aktuelle freie und gesamte Kapazität sowie den
Sale-Unlock-Zeitpunkt abrufen. Der Read-Pfad muss ohne PostgreSQL-Zugriff
funktionieren.

### REQ-F02 — Reservierung

Ein Kaufversuch reserviert höchstens ein Ticket und liefert eine eindeutige
`orderId`.

- Vor Sale-Unlock antwortet das System mit `425 Too Early`.
- Ohne freie Kapazität antwortet es mit `409 Conflict`.
- Bei Erfolg hält es den Inventaranspruch atomar und antwortet mit
  `202 Accepted`.
- Die Reservierung publiziert noch keinen dauerhaften Kauf.

### REQ-F03 — Payment-Bestätigung

Eine aktive Reservierung kann mit einem validen simulierten Payment bestätigt
werden. Erst dieser Schritt publiziert den Kauf-Intent zur asynchronen
Persistenz. Ein Publish-Fehler muss den gehaltenen Inventaranspruch vollständig
und idempotent freigeben.

Eine Reservierung, deren Checkout-Deadline verstrichen ist, darf nicht mehr
bestätigt werden; das System antwortet mit `410 Gone`. Die Ablehnung gibt selbst
kein Inventar frei — das bleibt der identitätsbasierten Recovery aus REQ-C04
vorbehalten. Ablehnungsgründe müssen unterscheidbar messbar sein.

### REQ-F04 — Checkout-Abbruch

Eine noch nicht finalisierte Reservierung kann abgebrochen werden. Wiederholtes
Abbrechen darf Inventar nicht mehrfach erhöhen. Eine bereits terminale Order
darf nicht zurück in den Checkout-Zustand wechseln.

### REQ-F05 — Order-Status

Clients können eine Order über `orderId` pollen. Unterstützte fachliche
Zustände sind mindestens `pending`, `completed`, `failed` und `expired`. Der
API-Read-Pfad nutzt ein Redis-Read-Model und keinen PostgreSQL-Read.

Ein abgelaufener Checkout muss als eigener Endzustand lesbar sein und darf nicht
als „nicht gefunden" erscheinen. Ein `pending` liefert zusätzlich seine Deadline
und die Serverzeit des Reads, damit ein Client eine verbleibende Restzeit ohne
Vertrauen in die eigene Uhr berechnen kann.

### REQ-F06 — Dauerhafte Finalisierung

Ein bestätigter Kauf erzeugt atomar genau eine dauerhafte Order und genau ein
Ticket. At-least-once-Zustellung darf keine zweite Order und kein zweites
Ticket für dieselbe `orderId` erzeugen.

### REQ-F07 — Reproduzierbarer Testzustand

Jede Messumgebung — lokal wie Cloud — kann Datenbank, Cache und Queue auf
einen definierten Fixture-Stand mit einer Million Tickets und kontrolliertem
Sale-Unlock zurücksetzen. Ein Messlauf beginnt immer auf diesem Stand.

## API-Vertrag

| Methode und Route                        | Verhalten                               | Erfolgsantwort             |
| ---------------------------------------- | --------------------------------------- | -------------------------- |
| `GET /api/tickets/:eventId/availability` | Redis-Verfügbarkeit lesen               | `200`                      |
| `POST /api/tickets/:eventId/buy`         | atomar reservieren                      | `202` mit `orderId`        |
| `POST /api/orders/:orderId/pay`          | Payment validieren und Kauf publizieren | `200` confirmed            |
| `POST /api/orders/:orderId/cancel`       | Pending-Reservierung freigeben          | `200` cancelled true/false |
| `GET /api/orders/:orderId`               | Order-Read-Model lesen                  | `200` oder `404`           |
| `GET /metrics`                           | Prometheus-Metriken bereitstellen       | `200`                      |

Request-, Response- und Event-Payloads werden zentral validiert. Ungültige
Payloads dürfen keine Seiteneffekte auslösen.

## Konsistenz und Fehlertoleranz

### REQ-C01 — Keine direkten API-DB-Writes

Kein HTTP-Kaufpfad darf direkt nach PostgreSQL schreiben. Die persistente
Schreiblast wird durch Pub/Sub vom Request-Spike entkoppelt.

### REQ-C02 — Atomare Inventarübergänge

Reserve, Release und Worker-Kompensation müssen innerhalb von Redis atomar sein.
Ein Release erhöht `available` nur, wenn derselbe `orderId`-Anspruch tatsächlich
aus dem Ledger entfernt wurde.

### REQ-C03 — Capacity-Invariante

Nach Sale-Ende und vollständig abgeschlossenem Queue-Drain gilt:

```text
available + durableTickets + activeReservations = totalCapacity
```

Eine Abweichung ist ein Systemfehler. Fehlende Operanden machen den Nachweis
`inconclusive`; sie dürfen nicht als Erfolg interpretiert werden.

### REQ-C04 — Identitätsbasierte Recovery

Verwaiste Reservierungen dürfen nur anhand einer konkreten `orderId` und ihres
fachlichen Zustands freigegeben werden. Alter oder TTL allein beweisen keinen
abgebrochenen Checkout. `publishing` oder bereits terminale Orders dürfen nie
allein wegen Zeitablauf freigegeben werden.

### REQ-C05 — ACK/NACK-Verhalten

- Erfolgreiche, bereits absorbierte oder terminal kompensierte Events werden
  bestätigt.
- Transiente Infrastrukturfehler und fehlgeschlagene Kompensation werden
  erneut zugestellt.
- Invalides Event-Payload darf nicht still als erfolgreicher Kauf enden.

### REQ-C06 — Fehlende Live-Keys

Fehlende Inventar-Keys während eines laufenden Sales sind ein beobachtbarer
Fehler. Runtime-Audits dürfen den Zustand nicht unbemerkt aus zeitversetzten
PostgreSQL- und Redis-Snapshots rekonstruieren. Initialisierung findet im
expliziten Reset-/Seed-Ablauf statt.

## Last- und Skalierungsanforderungen

### REQ-P01 — Lokales Referenzprofil

Der lokale k6-Lauf umfasst:

| Phase          | Dauer                |           Zielrate | Erwartetes Verhalten                |
| -------------- | -------------------- | -----------------: | ----------------------------------- |
| Warm-up        | 45 s                 |          1.000 RPS | Kaufversuche vor Unlock liefern 425 |
| Ramp-up        | 45 s                 | 1.000 → 10.000 RPS | Übergang in offenen Sale            |
| Sustained Sale | reaktiv bis Sold-out |         10.000 RPS | Reservieren, bezahlen, persistieren |
| Cool-down      | 60 s                 |          1.000 RPS | Sold-out und Queue-Drain beobachten |

Der Übergang zu Sold-out wird aus Systemzustand abgeleitet, nicht durch einen
festen Timer. Ob eine Messung bei dieser Zielrate als Kapazitätsnachweis
zitierbar ist, entscheidet ausschließlich REQ-P03.

### REQ-P02 — Cloud-Zielprofil

Das spätere GCP-Profil soll bis 50.000 RPS für Sale-Opening und Sustained Sale
prüfen. Dieses Ziel ist erst nach Cloud-Deployment und verteiltem Lastgenerator
ein belastbarer Kapazitätsnachweis.

### REQ-P03 — Ehrlicher Kapazitätsnachweis

Ein Lauf darf die Zielrate nicht als Backend-Kapazität ausweisen, wenn der
Lastgenerator relevante Iterationen verworfen hat oder der Mess-Stack
unvollständig war. Benchmark-Validität und Systemkorrektheit werden getrennt
bewertet.

### REQ-P04 — Backpressure

Überlast muss als Queue-Wachstum oder erhöhte E2E-Latenz sichtbar werden, ohne
die HTTP-API an die momentane PostgreSQL-Write-Kapazität zu koppeln.

## Observability-Anforderungen

### REQ-O01 — HTTP und Checkout

Metriken müssen Request-Rate, Statuscode und Latenz pro Route sowie
Reservationen, bestätigte Payments, Cancels und Publish-Rollbacks unterscheidbar
machen.

### REQ-O02 — Worker und Queue

Metriken müssen Completion, Failure, Redelivery, absorbierte Duplikate,
Idempotenztreffer, Kompensation und Publish-bis-Persist-Latenz sichtbar machen.

### REQ-O03 — Inventar und Datenbank

Metriken müssen freie, verkaufte und aktive Ansprüche, Capacity-Delta,
Ledger-Zustand, DB-Pool-Auslastung/-Wait, Query-Latenz, Lock-Waits und
Runtime-Sättigung zuordenbar machen.

Zusätzlich müssen die Wartungskomponenten selbst beobachtbar sein: Dauer,
Fehler und letzter Erfolg von Inventar-Audit und Sold-count-Projektion sowie
Kandidaten, Freigaben, übersprungene Zustände und Fehler der
identitätsbasierten Recovery. Der älteste fällige Pending-Anspruch muss
sichtbar sein. Die signierte Cross-System-Diagnose und die harte
Final-Invariante aus REQ-C03 bleiben getrennt auswertbar, damit ein
transienter Ausschlag nicht als Systemfehler gilt.

### REQ-O04 — Reproduzierbare Evidenz

Jeder qualifizierte Lastlauf erzeugt:

1. unveränderliche Rohdaten und Konfigurationssnapshot;
2. maschinenlesbare abgeleitete Fakten;
3. regelbasierte Validitäts- und System-Verdicts;
4. einen deterministischen Markdown-Report;
5. Grafana-Panelbilder für ein aus dem Run-Manifest abgeleitetes Zeitfenster.

Fehlender optionaler Bildexport darf vorhandene numerische Evidenz nicht
vernichten und muss nachholbar sein.

## Deployment-Anforderungen

Diese Anforderungen definieren, wann das Cloud-Deployment „genauso weit wie
lokal" ist. Sie sind technologieneutral; die Werkzeugwahl steht in ADRs.

### REQ-D01 — Reproduzierbare Umgebung

Die vollständige Zielumgebung entsteht aus versionierter Deklaration im
Repository, ist wiederholbar erzeugbar und rückstandsfrei wieder entfernbar.
Der Abbau ist Teil der Anforderung und begrenzt laufende Kosten. REQ-F07 gilt
in der Zielumgebung unverändert.

### REQ-D02 — Funktionale Parität bei Replikation

Alle funktionalen und Konsistenzanforderungen (REQ-F, REQ-C) gelten
unverändert, wenn die API mit mehreren Instanzen hinter einem Lastverteiler
läuft. Zeitabhängige Grenzen (Sale-Unlock, Checkout-Deadline) haben über
Instanzgrenzen hinweg eine definierte, dokumentierte Toleranz. Dauerhafte
At-least-once-Zustellung mit Duplikaten ist erwartetes Verhalten und kein
Paritätsverstoß. Die Instanzzahl jeder Komponente ist eine explizite,
begründete Entscheidung.

### REQ-D03 — Beweisfähigkeit

Messläufe in der Zielumgebung liefern dieselbe Evidenzqualität wie lokale
Läufe: Manifest, Zustands-Snapshots vorher/nachher, Drain-Beleg und
Validitäts-Verdicts nach REQ-O04. Ein Lauf in der Zielumgebung muss nach den
bestehenden Kompatibilitätsregeln gegen eine lokale Referenz-Baseline
vergleichbar sein.

### REQ-D04 — Observability-Parität

REQ-O01 bis REQ-O04 gelten in der Zielumgebung unverändert. Bei mehreren
Instanzen müssen Messwerte korrekt aggregiert sein: replizierte Zustandswerte
dürfen nicht mehrfach gezählt werden, und der Ausfall einer einzelnen Instanz
darf nicht hinter einem Sammelwert verschwinden.

### REQ-D05 — Zweistufiger Skalierungsnachweis

Der Kapazitätsnachweis in der Zielumgebung erfolgt in zwei getrennten Stufen:
zuerst Parität mit dem lokalen Referenzprofil (REQ-P01), erst danach das
Cloud-Zielprofil (REQ-P02). REQ-P03 gilt für beide Stufen unverändert.

### REQ-D06 — Betrieb und Schutz

Zugangsdaten liegen nie im Repository. Datenbank, Cache und Queue sind nicht
öffentlich erreichbar. Deploy, Messlauf, Diagnose und Abbau sind als
Runbook-Abläufe dokumentiert.

## Qualitäts- und Sicherheitsanforderungen

- Alle externen Payloads werden vor Seiteneffekten validiert.
- Erwartete Fachfehler haben stabile HTTP-Statuscodes und sichere Meldungen.
- Unbekannte interne Fehler geben in produktionsnahen Umgebungen keine
  Infrastrukturdetails an Clients weiter.
- Logs sind strukturiert, korrelierbar und für Cloud Logging auswertbar.
- Datenbank-, Request- und Event-Typen haben jeweils eine zentrale ableitbare
  Quelle.
- Änderungen sind über format, lint, typecheck, Tests und die dokumentierten
  Debug-Guardrails reproduzierbar prüfbar.

Die konkret gewählten Technologien und ihre Begründungen sind Entscheidungen,
keine Anforderungen. Sie stehen in den jeweiligen ADRs.
