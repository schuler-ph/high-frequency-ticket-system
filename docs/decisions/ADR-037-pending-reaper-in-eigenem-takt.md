# ADR-037: Der Pending-Reaper läuft in eigenem Takt, nicht im Inventory-Cycle

- **Status:** Fertig
- **Datum:** 2026-08-25
- **Kontext:** ADR-031 bündelt Sold-count Projector, Inventory Auditor und
  Pending-Reaper in einem Zyklus, der genau einen `COUNT(tickets)`-Snapshot
  teilt (`WORKER_INVENTORY_CYCLE_INTERVAL_SECONDS`, in allen Profilen 60 s).
  Vom Snapshot liest der Reaper aber nur die Event-Ids; seine eigentliche
  Arbeit — Kandidaten per ZSet-Score finden, per Lua identitätsbasiert
  freigeben — ist Redis-only. Die Kopplung setzt die Freigabelatenz eines
  abgelaufenen Anspruchs auf bis zu einen vollen Zyklus. Bei Deadlines von
  60–900 s fiel das nicht auf. Die komprimierte Zeitvariante von
  `browse-and-buy-human-pace` (Phase 4.13: Denkzeit 6 s, Deadline 12 s) macht
  es zum Messfehler: ein 60-s-Takt hielte abgelaufene Ansprüche bis zum
  Fünffachen der Deadline, das Sold-out-Ende wäre von Reaper-Latenz dominiert
  statt vom Systemverhalten, und die Profilaussage „Ablauf-Funnel unter
  realistischem Verhältnis von Denkzeit zu Deadline" wäre falsch.

  Die naive Lösung — den gemeinsamen Zyklus auf 12 s senken — verfünffacht den
  `COUNT(tickets)`-Projector und damit genau den DB-Druck, den ADR-031 und der
  Phase-4.9-Nachweis („keine Projector-Interferenz auf Pool-Wait") bewusst auf
  einen Snapshot je Zyklus begrenzt haben.

- **Entscheidung:**
  1. **Eigener Timer für den Reaper:** `WORKER_RESERVATION_REAPER_INTERVAL_SECONDS`,
     Pflichtwert jedes Profils (ADR-034). Der Inventory-Cycle behält seinen
     Takt und seinen einen Snapshot.
  2. **Event-Ids kommen aus dem letzten erfolgreichen Inventory-Cycle**, nicht
     aus einem eigenen DB-Read. `runInventoryCycle` gibt die Ids des Snapshots
     zurück; der Reaper startet aus dem ersten erfolgreichen Cycle heraus und
     plant sich danach selbst neu. Ein neu angelegtes Event wird damit
     spätestens einen Cycle später bereapt — bei einem seed-getriebenen System
     ohne Live-Event-Anlage kein Verlust.
  3. **Der Reaper-Vertrag nimmt `eventIds` statt `snapshots`.** Er hat nie mehr
     gelesen; der Typ sagt jetzt, was er braucht.
  4. **Nicht überlappend, `unref()`, sauberer Shutdown:** beide Timer werden erst
     nach Abschluss ihres Laufs neu geplant und im `onClose`-Hook geräumt. Ein
     Reaper-Fehler wird als `rejected` gemeldet und geloggt, stoppt aber weder
     den Consumer noch den nächsten Lauf.
  5. **Nebenläufigkeit ist keine neue Frage:** Reaper, Cycle und Consumer
     laufen jetzt zeitlich unabhängig, aber jede Freigabe war schon vorher ein
     einzelner atomarer, zustandsbewusster Lua-Aufruf (ADR-031 Ziffer 6 und 7),
     und Auditor wie Projector schreiben nichts nach Redis. Es entsteht keine
     Race-Klasse, die es nicht schon zwischen Reaper und Consumer gab.

- **Alternativen (verworfen):**
  - **Gemeinsamen Zyklus verkürzen:** einfachste Änderung, aber sie kauft die
    Reaper-Latenz mit fünffachem `COUNT(tickets)` — und zwar genau während des
    Sales, wo Phase 4.9 die Interferenz auf den Pool gemessen und ausgeschlossen
    hat.
  - **Reaper liest die Event-Liste selbst aus der DB:** unnötig; der Cycle
    liefert sie ohnehin, und ein zweiter DB-Pfad im Worker wäre ein weiterer
    Ort, an dem ADR-031 („Redis ist keine Dependency des Cycles, die DB keine
    des Reapers") aufweicht.
  - **Keyspace-Scan statt Event-Liste:** bereits in ADR-027 verworfen.
  - **Deadline-getriebene Selbstplanung** (nächster Lauf zur nächsten fälligen
    Deadline): präziser, aber ein Timer pro Event mit Sonderfällen für leere
    Ledger und Uhrensprünge — für den heutigen Bedarf (ein Event, feste
    Deadline) unangemessen.

- **Konsequenzen:** Alle Profile setzen den neuen Wert; 60 s entspricht dem
  bisherigen Verhalten, `browse-and-buy-human-pace` bekommt mit der
  komprimierten Zeit 6 s (halbe Deadline). Der Worker exponiert den Wert im
  `service_config_info`-Gauge, das Report-Manifest führt ihn in der Allowlist.
  Die Architekturaussage „ein Zyklus, ein Snapshot" gilt für Projector und
  Auditor unverändert (ADR-031 Nachtrag); `docs/ARCHITECTURE.md` beschreibt
  den Reaper als eigenen Takt. Der Lasttest-Nachweis der Entkopplung —
  Reaper-Läufe ~10× so häufig wie Auditor-Läufe, Projector-Rate unverändert —
  ist Teil der Baseline-F-Verifikation.
