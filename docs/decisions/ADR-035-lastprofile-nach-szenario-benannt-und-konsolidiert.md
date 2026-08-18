# ADR-035: Lastprofile nach Szenario benannt und konsolidiert

- **Status:** Fertig
- **Datum:** 2026-08-18
- **Kontext:** Es gab vier Lasttest-Profile (`capacity`, `realism`, `checkout`,
  `funnel`), deren Namen ihr Szenario nicht trugen — `funnel` war ohne
  Vorwissen nicht deutbar, und `realism` unterschied sich von `capacity` nur
  durch eine Denkzeit von 2–8 s, beantwortete also keine Frage, die nicht
  `capacity` (rohe Decke) oder `funnel` (menschliches Verhalten inklusive
  Ablauf-Semantik) besser beantwortete. Zusätzlich hingen zwei Code-Gates am
  Profil**namen** (`LOAD_PROFILE === "funnel"`): die Ledger-Abbruchbedingung
  im Orchestrator und die Ablauf-Invarianten im Analyzer. Ein Rename hätte
  beide still abgehängt. Schliesslich testete `capacity` den Reaper nie: bei
  einer 900-s-Deadline und ~6 min Laufzeit blieb die Abandon-Kohorte
  (~43k Ansprüche im Baseline-C-Split-Lauf) bis zum Ende offen und der Lauf
  endete unter der Kapazität statt bei exakt 1M verkauften Tickets.

- **Entscheidung:**
  1. **Drei Profile statt vier**, benannt nach dem Schema
     `<Traffic-Mix>-<Tempo>` — was die Last tut und wie schnell:
     - `browse-and-buy-full-speed` (früher `capacity`, Default),
     - `browse-and-buy-human-pace` (früher `funnel`; ersetzt zugleich
       `realism`, dessen Denkzeit-Szenario es realistischer abdeckt),
     - `buy-only-full-speed` (früher `checkout`; bleibt als Write-Pfad-Isolat,
       aktuell gebraucht für die Buy-Bein-Transportfehler).
       Keine Zahlen in Namen: Werte drift-en beim Tuning, der Name soll das
       Szenario tragen, die Datei die Werte (ADR-034).
  2. **`browse-and-buy-full-speed` endet bei exakt `SEED_CAPACITY` sold:**
     Checkout-Deadline 60 s statt 900 s (legitime Zahler ohne Denkzeit haben
     reichlich Luft; beobachtetes Latenz-Maximum im Crunch 13,9 s), Reaper-
     Batch 10000 (Auditor-Zyklus 60 s × ~120 Abläufe/s ≈ 7k Kandidaten pro
     Zyklus). Der Lauf testet Decke, Reaper und Wiederverkauf gemeinsam.
  3. **Gates hängen an Semantik, nicht an Namen:** Die Ledger-Abbruchbedingung
     und die Ablauf-Invarianten aktivieren sich, wenn die Checkout-Deadline
     innerhalb des Phase-A-Fensters ablaufen kann (≤ 600 s); der
     Expired-Pay-Check zusätzlich nur bei Denkzeit (`THINK_TIME_KIND` ≠
     `none`), weil ohne Denkzeit niemand zu spät zahlt. Invarianten-IDs heißen
     jetzt `sellout:`/`expiry:` statt `funnel:`.

- **Konsequenzen:** Läufe mit neuen Profilnamen sind per `spike:compare` nicht
  mit alten Läufen vergleichbar (bewusst akzeptiert; der Nutzer vergleicht
  nicht gegen alte Runs). Das umgebaute Default-Profil misst zusätzlich
  Reaper-Churn im Sell-out-Crunch — Latenz-/Dropped-Vergleiche mit dem
  Baseline-C-Split-Lauf vom 2026-08-17 sind nur mit diesem Vorbehalt zulässig.
  Historische Reports und Notizen behalten die alten Namen; sie beschreiben
  vergangene Läufe.
