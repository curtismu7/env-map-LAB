import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev only: the API runs on PORT (7805, npm start). Vite runs on VITE_PORT (dev-only, never published, default 5305) and proxies /api,
// so the browser only ever talks to one origin (same-origin writes). The one published/host port of this app is 7805.
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 7805}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 5305, strictPort: false, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", testTimeout: 20000 },
});
