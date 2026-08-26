# Phase 4.12: Lokale Baseline C mit getrenntem Lastgenerator (Zwei-Maschinen-Setup)

Abgeschlossene Detailnotiz zum Zwei-Maschinen-Setup. Der Vorspann liegt in der Backlog-Notiz `local-generator-split`, der Ablauf im Runbook. Der aktuelle Arbeitsstand steht in [`docs/TODO.md`](../../TODO.md).

## Abgeschlossene Todos (aus `docs/TODO.md` verschoben, 2026-08-26)

Der Todo-Index behaelt fuer diese Phase eine Zusammenfassung; die Einzelpunkte stehen hier, weil `docs/TODO.md` am 40-KiB-Backstop liegt (ADR-029).

Ersetzt das verworfene Phase-4.4-Todo auf lokalem Massstab: k6 auf dem Ryzen-PC, SUT allein auf dem MacBook, Ziel 5k RPS sustained (REQ-P01). → [Details](../backlogs/local-generator-split.md#backlog-lokaler-generator-sut-split-vorspann)

- [x] **SUT-Host (MacBook) vorbereiten:** API/Metrics auf LAN-IP binden, Fremdcontainer fuer den Lauf stoppen, Setup dokumentieren. → [RUNBOOK §3](../../RUNBOOK.md#zwei-maschinen-setup-generator-getrennt-vom-sut), Task `loadtest:stack up` (Topologie-Abfrage)
- [x] **Generator-Host (Ryzen-PC) anbinden:** ssh-Spawn als Hauptpfad, manueller Lauf nur Fallback; Ethernet, WLAN nur Fallback. → [RUNBOOK §3](../../RUNBOOK.md#generator-host-einrichten-windows-pc), [§4 Split-Kommando](../../RUNBOOK.md#zwei-maschinen-lauf-k6-auf-dem-generator-pc)
- [x] **Baseline C mit getrenntem Generator fahren:** Gefahren 2026-08-17: `degraded` (3,10 % dropped), `system pass`, echter Sellout, ~8k Iterationen/s sustained (REQ-P01 mit Vorbehalt uebertroffen). → [Report](../../reports/baseline-d-2026-08-17/LOAD-TEST-REPORT-2026-08-17.md)
- [x] **Transportfehler nach Endpunkt aufschluesseln:** Threshold-Sub-Metriken (`count>=0`) in beiden Phasen-Skripten, Aufschluesselung in Report §4; bewusst endpoint-only, kein `error_code`-Kreuzprodukt.
- [x] ~~Transportfehler auf dem Buy-Bein · Valid-Baseline nachziehen · je Profil ein gueltiger Lauf.~~ **Aufgeloest 2026-08-25:** Transportfehler waren zu 97 % Fachstatus (409/425); der Rest lebt mit den Laeufen in Phase 4.13.
- [x] **Lastprofile konsolidieren und nach Szenario benennen:** 4 → 3 Profile (`browse-and-buy-full-speed` als Default mit Sellout-Semantik, `browse-and-buy-human-pace`, `buy-only-full-speed`); `realism` entfaellt, Gates haengen an Semantik statt Namen. → ADR-035
- [x] **Generator-Kardinalitaet begrenzen:** die orderId im k6-`name`/`url`-Tag erzeugte eine Zeitreihe pro Bestellung (3,2 Mio nach ~3,5 min). Statischer `name`-Tag plus `SYSTEM_TAGS` ohne `url`.
