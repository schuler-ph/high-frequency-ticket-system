import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Reine SPA: kein Server-Rendering, kein Node zur Laufzeit. `vite build`
// erzeugt statische Dateien in `dist/`, die jeder Webserver ausliefern kann;
// Client-Routing (`/checkout/:orderId`) braucht dort nur einen Fallback auf
// `index.html` (ADR-039).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 10001, strictPort: true },
  preview: { port: 10001, strictPort: true },
});
