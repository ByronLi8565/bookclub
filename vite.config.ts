import { defineConfig, transformWithEsbuild, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import { fixtureServer } from "./src/tests/harness/testServer.ts";

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
  plugins: [
    lowerDecorators(),
    react(),
    // Reads wrangler.jsonc and runs the worker (Durable Objects, bindings) in
    // workerd for both `vite dev` and the production build/deploy.
    cloudflare(),
    VitePWA({
      // Auto-update: the plugin forces skipWaiting + clientsClaim and reloads
      // open tabs once a new version activates, so the cached app shell always
      // stays internally consistent (no stale hashed-asset references).
      registerType: "autoUpdate",
      // Icons live in publicDir (`public/`) and are copied verbatim to the dist root.
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Bookclub",
        short_name: "Bookclub",
        description: "Read and annotate books together.",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the built app shell so the app boots offline.
        globPatterns: ["**/*.{js,css,html,wasm}"],
        // Offline navigations fall back to the SPA shell...
        navigateFallback: "/index.html",
        // ...but never for API/agent traffic — let those hit the network and fail honestly.
        navigateFallbackDenylist: [/^\/(auth|groups|me|agents|admin)\//u],
        // pdf.js worker + epub assets can be large; lift the precache size ceiling.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      // Keep the service worker out of `vite dev` to avoid HMR/caching confusion.
      devOptions: { enabled: false },
    }),
    fixtureServer(new URL("./assets", import.meta.url).pathname),
  ],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@assets": new URL("./assets", import.meta.url).pathname,
    },
  },
});
