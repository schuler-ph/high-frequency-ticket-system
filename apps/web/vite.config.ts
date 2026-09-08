import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Literal statt Env-Variable: der Port-Block 10001-10009 ist im Repo fix
// vergeben, ein Dev-Proxy-Ziel ist keine Deployment-Konfiguration (ADR-043).
const DEV_API_TARGET = "http://localhost:10002";

/**
 * Reine SPA: kein Server-Rendering, kein Node zur Laufzeit. `vite build`
 * erzeugt statische Dateien in `dist/`, Client-Routing braucht dort nur einen
 * Fallback auf `index.html` (ADR-039).
 *
 * Diese Config liest kein Env-Profil — `apps/web` ist konfigurationsfrei
 * (ADR-043). Die `proxy`-Bloecke stellen lokal denselben Origin her, den im
 * Betrieb nginx bzw. der Ingress liefert.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 10001,
    strictPort: true,
    proxy: { "/api": { target: DEV_API_TARGET, changeOrigin: true } },
  },
  preview: {
    port: 10001,
    strictPort: true,
    proxy: { "/api": { target: DEV_API_TARGET, changeOrigin: true } },
  },
});
