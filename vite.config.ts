import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Alchemy injects the Cloudflare vite plugin when it drives the build. That
// plugin resolves the worker (SSR) entry from the ssr environment's input when
// Alchemy does not pass an explicit `main`, so we point it at our worker here.
export default defineConfig({
  plugins: [react()],
  environments: { ssr: { build: { rollupOptions: { input: "src/server/worker.ts" } } } },
  // Local dev: this server serves the client with HMR and forwards agent
  // traffic (http + websocket) to `wrangler dev`, which hosts the NoteAgent
  // durable object. In production the deployed worker serves both itself.
  server: {
    proxy: { "/agents": { target: "http://localhost:8787", ws: true, changeOrigin: true } },
  },
});
