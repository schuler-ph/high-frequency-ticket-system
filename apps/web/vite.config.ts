import { profileVarsWithPrefix } from "@repo/env/profile";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite liest `.env`-Dateien nur aus dem eigenen Verzeichnis, die Profile dieses
// Repos liegen aber in `@repo/env` (ADR-041). Deshalb holt die Config die Werte
// selbst aus dem Profil — modul-relativ aufgeloest im Paket, nicht ueber einen
// Repo-Layout-Pfad. Uebernommen werden nur die `VITE_*`-Variablen: ein
// `NODE_ENV` aus dem Profil wuerde Vites Modus-Erkennung ueberschreiben. Was
// schon im Prozess-Env steht, behaelt Vorrang (ADR-034).
for (const [key, value] of Object.entries(profileVarsWithPrefix("VITE_"))) {
  process.env[key] ??= value;
}

// Reine SPA: kein Server-Rendering, kein Node zur Laufzeit. `vite build`
// erzeugt statische Dateien in `dist/`, die jeder Webserver ausliefern kann;
// Client-Routing (`/checkout/:orderId`) braucht dort nur einen Fallback auf
// `index.html` (ADR-039).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 10001, strictPort: true },
  preview: { port: 10001, strictPort: true },
});
