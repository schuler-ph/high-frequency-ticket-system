# Backlog: Lokaler Generator-SUT-Split (Phase 4.12)

Offene Detailnotiz zur lokalen Baseline C mit getrenntem Lastgenerator.

### Backlog lokaler Generator-SUT-Split: Vorspann

> Beim Einsortieren des offenen Phase-4.4-Todos (2026-08-14) entstanden: alle bisherigen Kapazitaetslaeufe fuhren Generator **und** SUT auf derselben Maschine (`darwin/arm64, 11 CPUs`). Der Run vom 2026-08-03 zeigt das Problem exakt: das SUT nutzte ~1,3 von 11 Cores, den Rest fraß k6 — die 57,9 % dropped iterations sind fast reine Generator-Contention, keine Systemgrenze. Die real gemessenen Backend-Decken (API-Prozess ~8k req/s bei 0,80 Cores Event-Loop-gebunden, Worker-DB-Pool mit bis zu 6.530 Wartenden) wurden noch nie ohne mitlaufenden Generator vermessen. Der Split ist billig, weil `BASE_URL` in `load-tests/lib/scenario-helpers.js` bereits per Env umbiegbar ist und ein **einzelner** Remote-Generator kein Summary-Merging braucht.

### Warum das 50k-Todo verworfen wurde

> Das urspruengliche Phase-4.4-Todo forderte den Split gleich fuer das 50k-RPS-Ziel (~20k aktive VUs, 0 dropped). Das ist lokal in keiner Konstellation erreichbar: REQ-P02 verortet 50k RPS explizit **nach** Cloud-Deployment und verteiltem Lastgenerator; 20k VUs sprengen einen einzelnen Generator-Host; und das Single-Node-SUT deckelt ohnehin bei ~8k req/s pro API-Prozess. Der 50k-Strang ist vollstaendig in Phase 4.11 („Verteilten k6-Runner orchestrieren“ — dort liegt auch der fachlich harte Teil, das korrekte Zusammenfuehren von Quantilen ueber Teil-Summaries) und Phase 5 (GKE-Replikas, Cloud-Lasttest) abgedeckt. Uebrig bleibt der lokal wertvolle Kern: den Generator vom SUT trennen, damit die lokale Kapazitaetsaussage (REQ-P01: 5k RPS sustained) erstmals gueltig wird (REQ-P03, Dropped-Policy ≤ 5 % laut `load-tests/report-policy.json`).

### SUT-Host vorbereiten

> - [ ] **SUT-Host (MacBook M3) vorbereiten:** API (Port 10002) und Monitoring-Stack auf der LAN-IP erreichbar machen (Bind-Adresse/Firewall pruefen), Fremdcontainer fuer den Lauf stoppen (Baseline-B-Learning: envoy/mysql/redis/static-server liefen mit und drueckten den Load Average auf 21,95 bei 11 Cores). Der Report-Orchestrator (`pnpm spike:report`) bleibt auf dem SUT-Host, weil `scripts/load-test/lib/snapshots.mjs` per `docker exec` auf `hts-postgres`/`hts-redis` zugreift. Setup als kurzer Abschnitt im RUNBOOK dokumentieren, sobald es steht.

### Generator-Host anbinden

> - [ ] **Generator-Host (Ryzen 5800X3D) anbinden:** k6 installieren (Windows-Binary oder WSL) und `BASE_URL` auf die SUT-LAN-IP setzen. Minimalpfad: k6 manuell oder per ssh auf dem PC starten und die `--summary-export`-Datei zurueck auf den SUT-Host holen, wo `summarisePhase` (`scripts/load-test/lib/analyze.mjs`) sie wie bisher als einzelne Summary liest. Optionaler Ausbau: `spawnK6` (`scripts/load-test/lib/processes.mjs`) einen ssh-Spawn-Pfad geben, damit `spike:report` den Remote-Lauf selbst orchestriert (inkl. SIGINT-Weiterleitung fuer das Sold-out-Plateau). **Netz: Ethernet** (Direktkabel oder Router-LAN); WLAN nur als dokumentierter Fallback — die 2,7–4,4 % Transportfehler aus Baseline C/2026-08-03 wuerden ueber einen WLAN-Hop eher wachsen. Aufwand: ~0,5 Tage Minimalpfad, ~1–1,5 Tage mit ssh-Spawn.

### Baseline C mit getrenntem Generator fahren

> - [ ] **Baseline C mit getrenntem Generator fahren:** Zielprofil REQ-P01 (5k RPS sustained bis Sold-out), Benchmark-Gueltigkeit nach Dropped-Policy (≤ 5 %, Ziel 0). Erst mit diesem Lauf sind die echten Backend-Decken bewertbar: API-Prozess (~8k req/s, Event-Loop-Lag) und `DATABASE_POOL_MAX=50` (Messlauf steht laut Phase 4.6 P1 noch aus). Dabei die Transportfehler-Hypothese aus Phase 4.6 pruefen: verschwinden die 2,7 % Requests ohne App-Antwort (109.386 in Baseline C) mit getrenntem Generator, war es Host-Contention; bleiben sie, ist es ein echtes Problem und bekommt ein eigenes Todo. Ergebnis fliesst als Vorher/Nachher in den Report; der Lauf selbst braucht eine ausdrueckliche, aktuelle Freigabe (CLAUDE.md-Regel zu Lasttests). Nebeneffekt fuer Phase 4.11: BASE_URL-Parametrisierung und Runner-Anbindung loesen sich vom Localhost und de-risken die Cloud-Variante.
