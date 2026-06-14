import { defineConfig, transformWithEsbuild, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// workerd cannot parse TC39 decorators, which the agents SDK uses via @callable.
// Vite 8 transforms with oxc, and oxc only lowers *legacy* decorators — it leaves
// the standard decorators agents uses raw, so the deployed worker fails at
// startup ("Invalid or unexpected token"). esbuild lowers standard decorators
// correctly, so pre-transform the agent sources with esbuild (target es2022)
// before oxc runs. Only files that actually use @callable are touched.
function lowerDecorators(): Plugin {
  return {
    name: "bookclub:lower-decorators",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".ts") || !code.includes("@callable")) return null;
      return transformWithEsbuild(code, id, { loader: "ts", target: "es2022" });
    },
  };
}

export default defineConfig({
  plugins: [lowerDecorators(), react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@assets": new URL("./assets", import.meta.url).pathname,
    },
  },
  environments: { ssr: { build: { rollupOptions: { input: "src/server/worker.ts" } } } },
  // Local dev: this server serves the client with HMR and forwards agent
  // traffic (http + websocket) to `wrangler dev`, which hosts the durable
  // objects. In production the deployed worker serves both itself.
  server: {
    proxy: {
      "/agents": { target: "http://localhost:8787", ws: true, changeOrigin: true },
      "/auth": { target: "http://localhost:8787", changeOrigin: true },
      "/groups": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
