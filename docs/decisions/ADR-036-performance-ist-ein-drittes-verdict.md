# ADR-036: Performance ist ein drittes Verdict, nicht Teil der Benchmark-Validität

- **Status:** Fertig
- **Datum:** 2026-08-25
- **Kontext:** Der Report-Generator kennt zwei Verdicts (REQ-P03):
  `benchmark` beantwortet „war der Lastgenerator groß genug, damit die
  Zielrate als Kapazität zitierbar ist?", `system` beantwortet „ist das
  Inventar korrekt geblieben?". Latenz kam in keinem der beiden vor. In
  Baseline E (2026-08-18) meldeten beide Full-Speed-Läufe `system: pass`,
  obwohl k6 den Threshold `http_req_duration p(95)<500` mit 876 ms bzw.
  809 ms gerissen hatte. Die Information lag bereits im Artefakt —
  `phase-a-summary.json` trägt je Metrik ein `thresholds`-Objekt (k6-Legacy-
  Semantik: `true` = gerissen) — wurde aber nirgends weitergereicht. Damit
  konnte ein Lauf als Referenz-Baseline durchgehen, dessen Nutzer 2 s auf
  `/pay` warten. Zusätzlich stuft der Orchestrator k6-Exit-Code 99
  („thresholds failed") als erwarteten Exit ein, damit der Report trotzdem
  entsteht; das Prozess-Signal ging dadurch ebenfalls verloren.

- **Entscheidung:**
  1. **Drittes, unabhängiges Verdict `performance`** mit den Stufen `pass`,
     `fail`, `inconclusive`, berechnet aus den k6-Thresholds der Phasen-
     Skripte. `summarisePhase` reicht die Thresholds je Phase in
     `derived.json` durch (`offeredLoad.phases[].thresholds`, inklusive des
     beobachteten Werts der beurteilten Aggregation), `performanceVerdict`
     in `lib/validate.mjs` beurteilt sie, der Report zeigt sie in §2 und §3a.
  2. **Explizite Gate-Liste statt Heuristik:** Nur die in
     `load-tests/report-policy.json` unter `performance.gates` genannten
     Metriken (`http_req_duration`, `http_req_failed`) fließen ins Verdict.
     Dieselbe `thresholds`-Map trägt auch reine Export-Selektoren
     (`transport_errors{endpoint:*}` mit `count>=0`), die nur existieren, um
     Sub-Metriken in der Summary zu materialisieren. „Irgendein Threshold
     gerissen → fail" wäre heute zufällig richtig und beim ersten kippenden
     Selektor falsch.
  3. **`inconclusive` statt erfundenem `pass`:** Ein Artefakt ohne
     Thresholds (Baseline A) oder ohne eines der Gates beantwortet die Frage
     nicht — es wird nicht zu seinen Gunsten ausgelegt. Ein `derived.json`
     mit Schema < 3 rendert ebenfalls `inconclusive`.
  4. **Exit-Code 99 bleibt erwarteter Exit**, wird aber im Report §3a
     sichtbar gemacht statt verschluckt. Der Prozess-Exit von `spike:report`
     bleibt an `system: fail` gebunden: ein gerissenes Latenz-Gate ist ein
     Befund über den Lauf, kein kaputter Lauf.

- **Alternativen:**
  - **Gerissene Latenz als `degraded` im Benchmark-Verdict.** Kleinster Diff,
    kein Schema-Bump. Verworfen, weil es „Generator zu klein" und „System zu
    langsam" in einer Zahl vermischt — genau die Trennung, die REQ-P03 und
    der Docstring von `validate.mjs` bewusst ziehen. Ein `degraded` müsste
    dann jedes Mal aufgelöst werden, bevor es etwas aussagt.
  - **Latenz als Invariante im System-Verdict.** Verworfen: Korrektheit ist
    binär und beweisbar, Latenz ist ein Schwellenwert gegen ein Ziel. Ein
    `system: fail` soll weiterhin heißen „Inventar verletzt", nicht „langsam".
  - **k6 die Entscheidung überlassen (Exit-Code 99 → Report abbrechen).**
    Verworfen: Phase A wird reaktiv per REST/SIGINT gestoppt und endet nie
    mit 99; das Signal wäre auf Phase B beschränkt und der Report für
    gerissene Läufe gar nicht entstanden.

- **Konsequenzen:** `DERIVED_SCHEMA_VERSION` und `RENDERER_VERSION` springen
  auf 3; die Goldens sind neu erzeugt, und ein zweites Fixture
  (`baseline-e-full-speed`, aus dem Lauf `2026-08-18T19-09-19-323Z-a05409f`)
  hält den `fail`-Pfad fest. `spike:compare` trägt `performance` in seinen
  Verdicts mit. REQ-P03 nennt jetzt drei Bewertungsdimensionen. Im Rückblick
  sind beide Full-Speed-Läufe von Baseline E `performance: fail` — was
  Baseline F (Phase 4.13) sichtbar reparieren oder bewusst dokumentiert
  stehen lassen muss. Eine Änderung der Gate-Liste oder der Thresholds in
  den Phasen-Skripten ist eine Report-Logik-Änderung und wird zusammen mit
  den Goldens geprüft.
