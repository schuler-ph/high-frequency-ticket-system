---
description: Wie man den k6 Lasttest kombiniert mit dem lokalen Docker-Setup ausführt und analysiert.
---

# Workflow: Run Loadtest

1. **Infrastruktur sicherstellen**: Vergewissere dich, dass Hintergrunddienste gestartet sind (PostgreSQL, Redis, Pub/Sub Emulator, Prometheus, Grafana).
   `docker compose up -d`
2. **Applikation starten**: Starte die Services des Projekts.
   `pnpm run dev`
3. **k6 Lasttest ausführen**: Führe das fertige Skript aus und weise k6 an, die Metriken an das lokale Prometheus zu schicken.
   `k6 run --out prometheus=http://localhost:9090 load-tests/spike.js`
4. **In Grafana überwachen**: Öffne die lokale Grafana-UI (idR. `http://localhost:3000`) und rufe das entsprechende Loadtest/Performance-Dashboard auf.
5. **Ergebnisse dokumentieren**:
   - Prüfe die Latenz (p95) beim Spike (50.000 RPS).
   - Beobachte die Error-Rates (z.B. HTTP 409 Konflikte beim Sold-Out).
   - Speichere ggf. Screenshots für die `README.md`.
