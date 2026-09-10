# ADR-041: Env-Profile liegen im Paket `@repo/env`, nicht in einem Repo-Ordner

- **Status:** Umgesetzt
- **Datum:** 2026-09-07
- **Ersetzt:** ADR-040 Entscheidung 1
- **Kontext:** ADR-034 hat die Konfiguration auf genau eine Quelle gezogen:
  ein Profil ist eine vollständige, eingecheckte Datei, und `@repo/env` lädt
  genau eine davon. Der Ablageort war `config/env/` im Repo-Root, also
  außerhalb jedes Workspace-Pakets. Der Loader in `packages/env/` musste ihn
  deshalb über drei Ebenen nach oben auflösen (`../../../config/env/`), und
  dieselbe Aufwärtsrechnung stand nochmals in `require-profile.mjs`,
  `run-with-profile.mjs` und `check-env-profiles.mjs`.

  Beim Containerbau wurde daraus ein Fehler mit Folgen: `turbo prune` kopiert
  nur Workspace-Pakete, `config/` ist keins. Ein Image enthielt die Profile
  also nicht, und der Loader fiel auf ein leeres Verzeichnis — Fail-Fast mit
  der Meldung „(keine gefunden)". ADR-040 hat das mit einer expliziten
  `COPY`-Zeile im Dockerfile geheilt, die den Ordner an derselben relativen
  Tiefe wiederherstellt, und den Preis dafür selbst benannt: das Dockerfile
  ist damit hart an die Verzeichnistiefe von `dist/` gebunden. Jedes weitere
  Image (Worker, später kind/GKE) braucht dieselbe Zeile, und jede Änderung
  am Layout bricht sie still.

- **Entscheidung:**
  1. **Die Profile liegen in `packages/env/profiles/`**, also in dem Paket,
     das sie lädt. `@repo/env` löst sie als `../profiles/` auf — ein Schritt
     statt drei, und derselbe Ausdruck gilt für `src/` und `dist/`, weil beide
     dieselbe Tiefe im Paket haben.
  2. **Der Transport ins Image ist keine Sonderregel mehr.**
     `pnpm --filter=api --prod --legacy deploy` kopiert das Paketverzeichnis
     von `@repo/env` vollständig; `turbo prune` nimmt das Paket als
     Workspace-Abhängigkeit ohnehin mit. Die Profile reisen dadurch überall
     mit, wo `@repo/env` mitreist. Die `COPY`-Zeile im Dockerfile entfällt.
  3. **`@repo/env` bekommt kein `files`-Feld.** Das Feld würde den
     Deploy-Output auf die genannten Pfade beschränken und `profiles/`
     stillschweigend wieder aus dem Image werfen — genau der Fehler, den
     dieser ADR beseitigt, nur schwerer zu finden. `apps/api` hat ein solches
     Feld (`files: ["dist"]`); für `@repo/env` ist es verboten.
  4. **Die Profil-Auswahl bleibt unverändert.** `HFTS_ENV` ohne
     Default, eine Datei pro Profil, keine Vererbung, `override: false`,
     `pnpm run debug:env` prüft Vollständigkeit. Dieser ADR verschiebt einen
     Ort, keine Regel.
- **Begründung:**
  - **Der Loader und seine Daten gehören zusammen.** Ein Paket, dessen einzige
    Aufgabe das Laden von Profilen ist, und die Profile selbst am selben Ort —
    das ist die Ablage, aus der sich der Rest von selbst ergibt. Die
    Aufwärtsrechnung über drei Ebenen war ein Symptom davon, dass Code und
    Daten getrennt lagen.
  - **Werkzeuge, die Pakete verstehen, transportieren dann richtig.**
    `turbo prune` und `pnpm deploy` arbeiten beide auf Paketgrenzen. Solange
    die Profile außerhalb lagen, musste jede Verpackung von Hand nachgebessert
    werden; innerhalb des Pakets ist der Transport das Normalverhalten.
  - **Ein Ort weniger, der falsch sein kann.** Vorher konnte die Tiefe im
    Dockerfile, im Loader und in drei Skripten auseinanderlaufen, ohne dass
    ein Typfehler oder ein Test es meldet — der Bruch zeigte sich erst beim
    Containerstart.
- **Alternativen:**
  - **`config/env/` behalten und pro Image eine `COPY`-Zeile pflegen** (der
    Zustand aus ADR-040): funktioniert, kostet aber eine handgeschriebene
    Tiefenangabe je Dockerfile. Der Worker und die kind-Manifeste hätten sie
    ebenfalls gebraucht.
  - **Profile in ein eigenes Workspace-Paket** (`@repo/env-profiles`): löst
    den Transport genauso, fügt aber ein Paket ohne Code hinzu und trennt die
    Profile weiterhin von ihrem Loader. Kein Gewinn gegenüber einem
    Unterordner.
  - **Profile ins Image backen statt zur Laufzeit wählen** (ein Profil pro
    Build): macht `HFTS_ENV` zum Build-Argument und den Profilwechsel
    zum Rebuild. ADR-040 Entscheidung 3 hat das bewusst verworfen.
- **Konsequenzen:**
  - Der Loader ist auf `new URL("../profiles/", import.meta.url)` verkürzt;
    `require-profile.mjs` und `check-env-profiles.mjs` zeigen auf denselben
    neuen Ort. (`run-with-profile.mjs` ebenfalls, bis es der
    ADR-034-Nachtrag 2026-09-08 durch den Subpath-Export `@repo/env/profile`
    ersetzt hat.)
  - `apps/api/Dockerfile` kopiert kein Profil mehr. ADR-040 ist damit
    vollständig umgesetzt statt teilweise.
  - `turbo.json` nennt `../../packages/env/profiles/*.env` als Build- und
    Test-Input. Der Eintrag bleibt nötig: für Konsumenten wie `api` und `web`
    deckt `$TURBO_DEFAULT$` nur das eigene Paket ab.
  - `.gitignore` und `.dockerignore` schützen weiterhin
    `packages/env/profiles/*.local.env`. Der `.dockerignore`-Eintrag ist jetzt
    wichtiger als vorher: `pnpm deploy` kennt kein gitignore, ein lokal
    vorhandenes `split.local.env` mit Host-Topologie würde sonst ins Image
    wandern.
  - Alle Cloud-Profile liegen ab jetzt in jedem Image, das `@repo/env`
    enthält, nicht mehr nur das eine per `COPY` gewählte. Das ist unkritisch,
    weil Zugangsdaten laut ADR-040 Entscheidung 2 leere Zuweisungen sind, aber
    es ist eine bewusste Verhaltensänderung.
