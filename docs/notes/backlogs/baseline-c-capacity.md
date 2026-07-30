# P1 — Kapazitaet weitertreiben

Offene Detailnotiz zur weiteren Kapazitaetsarbeit nach Baseline C.

## DATABASE_POOL_MAX erhoehen und neu messen

> - [ ] **`DATABASE_POOL_MAX` erhoehen und neu messen (Report §7):** Der Pool ist der bindende Engpass — `waiting` erreichte **1.070** Acquirer bei Pool-Groesse **20**, waehrend `db_locks_waiting` bei **0** blieb. Gegenprobe ueber Little's Law: 20 Connections / 3.300 Completions pro Sekunde ⇒ ~6,1 ms Servicezeit, theoretische Decke `20 / 6,1 ms = 3.300/s` — exakt der beobachtete Peak. Die gemessene Query-Latenz (p95 460 ms) ist damit fast vollstaendig Pool-Wartezeit, nicht DB-Arbeit. Erst 50, dann 100 testen; erwartet ~8.250/s bzw. ~16.500/s. **Batched Inserts bewusst zurueckgestellt:** solange Postgres 6 ms braucht und 0 Lock-Waits meldet, ist nicht die Datenbank das Problem, sondern der Zugang zu ihr — Batching wuerde ACK-Granularitaet, Idempotenz und Fehlerisolierung pro Nachricht verkomplizieren, ohne dass ein Beleg dafuer vorliegt. — **Stand 2026-07-27:** Knopf gesetzt — `DATABASE_POOL_MAX=50` im `start:loadtest`-Script des Workers (nur Lasttest-Profil; Dev bleibt bei Default 20). Bewusst 50 statt 100: Postgres laeuft mit `max_connections=100`, und der Worker-Pool traegt auch den Reconcile — 50 laesst Headroom fuer Debug-Sessions und den Sprung auf 100 erst nach einer `max_connections`-Erhoehung. Die **Messung** ist der naechste `pnpm spike:report`-Lauf (Baseline D); erst dessen Zahlen schliessen dieses Todo.

## k6-maxVUs und Zielrate in Einklang bringen

> - [x] **k6-`maxVUs` und Zielrate in Einklang bringen:** `maxVUs=5.000` bei Ziel 10.000 Iterationen/s deckt nur ~0,5 s Iterationsdauer ab. Als die Latenz im Crunch auf p95 874 ms stieg, waeren ~8.700 VUs noetig gewesen → 21,85 % dropped. Entweder `maxVUs` an `Zielrate × erwartete Iterationsdauer` anpassen oder die Zielrate senken; sonst sind Verwerfungen rechnerisch garantiert und der Lauf bleibt `invalid`. — Umgesetzt: `maxVUs` in `spike-phase-a.js` von 5.000 auf **10.000** (deckt die 10k-Zielrate bis ~1 s Iterationsdauer; Kommentar mit der Little's-Law-Rechnung im Skript). Das Host-Risiko von Baseline B ist gesunken, weil das k6-Remote-Write inzwischen standardmaessig aus ist. Ob 10.000 lokal reichen, zeigt Baseline D — die Alternative (Zielrate senken) bleibt dokumentiert.

## Transportfehler untersuchen

> - [ ] **Transportfehler untersuchen:** 109.386 Requests (2,7 %) bekamen keine App-Antwort, bei 0 % 5xx. Deutet auf Host-Netzwerkgrenzen (Accept-Queue, ephemere Ports) bei 13 K req/s, nicht auf Applikationsfehler. Vor einem Kapazitaetslauf klaeren, sonst verfaelscht es jede Fehlerrate. Haengt mit #244 zusammen.
