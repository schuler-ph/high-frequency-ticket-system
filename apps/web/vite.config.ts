import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Ziel des API-Proxys im Dev- und Preview-Server.
 *
 * Bewusst ein Literal und keine Env-Variable: der Port-Block 10001–10009 ist
 * im Repo fix vergeben (siehe `docs/RUNBOOK.md`, „Standardports"), und ein
 * Proxy-Ziel des lokalen Dev-Servers ist keine Deployment-Konfiguration. Es
 * aus einem Profil zu lesen wuerde eine neue Env-Variable *einfuehren* — das
 * Gegenteil des Ziels, `apps/web` konfigurationsfrei zu halten.
 */
const DEV_API_TARGET = "http://localhost:10002";

/**
 * Reine SPA: kein Server-Rendering, kein Node zur Laufzeit. `vite build`
 * erzeugt statische Dateien in `dist/`, die jeder Webserver ausliefern kann;
 * Client-Routing (`/checkout/:orderId`) braucht dort nur einen Fallback auf
 * `index.html` (ADR-039).
 *
 * Diese Config liest **kein** Env-Profil. `apps/web` hat keine
 * `VITE_*`-Variablen mehr: die API wird same origin unter `/api/...`
 * angesprochen, die Event-Id ist eine Konstante aus `@repo/types`. Damit
 * braucht `vite build` kein `HTS_ENV_PROFILE`, ist ueber Profile hinweg
 * cachebar, und dasselbe `dist/` laeuft in jeder Umgebung.
 *
 * Den gemeinsamen Origin stellt zur Laufzeit ein Reverse Proxy her — nginx im
 * Container, der Ingress in GKE. Lokal tun das die beiden `proxy`-Bloecke
 * unten, damit Dev und Preview sich genauso verhalten wie die deployte App
 * und nicht ueber getrennte Origins gegen CORS laufen.
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
