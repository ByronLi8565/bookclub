import { defineConfig, transformWithEsbuild, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import { fixtureServer } from "./src/tests/harness/testServer.ts";

const PDFJS_WASM_PATH = "/pdfjs-wasm/";
const PDFJS_WASM_FILES = [
  "jbig2.wasm",
  "jbig2_nowasm_fallback.js",
  "openjpeg.wasm",
  "openjpeg_nowasm_fallback.js",
  "qcms_bg.wasm",
] as const;

function pdfjsWasm(): Plugin {
  const files = new Map(
    PDFJS_WASM_FILES.map((name) => [
      name,
      readFileSync(new URL(`./node_modules/pdfjs-dist/wasm/${name}`, import.meta.url)),
    ]),
  );
  return {
    name: "bookclub:pdfjs-wasm",
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    configureServer(server) {
      server.middlewares.use(PDFJS_WASM_PATH, (request, response, next) => {
        const name = request.url?.split("?", 1)[0]?.replace(/^\//u, "");
        const source = name ? files.get(name as (typeof PDFJS_WASM_FILES)[number]) : undefined;
        if (!source) return next();
        response.setHeader(
          "Content-Type",
          name?.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8",
        );
        response.end(source);
      });
    },
    generateBundle() {
      for (const [name, source] of files) {
        this.emitFile({ type: "asset", fileName: `${PDFJS_WASM_PATH.slice(1)}${name}`, source });
      }
    },
  };
}

// workerd cannot parse the standard decorators used by @callable; esbuild can lower them.
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

export default defineConfig(({ command }) => ({
  plugins: [
    lowerDecorators(),
    pdfjsWasm(),
    react(),
    // Local DOs need a dev-only migration for SQLite-backed agents; prod config stays untouched.
    command === "serve"
      ? cloudflare({
          config: (config) => {
            config.vars = { ...config.vars, DEV_AUTH: "true" };
            config.migrations = [
              {
                tag: "dev-sqlite-v1",
                new_sqlite_classes: ["NoteAgent", "AuthAgent", "GroupAgent", "GroupRegistry"],
              },
            ];
          },
        })
      : cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
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
        globPatterns: ["**/*.{js,css,html,wasm}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/(auth|groups|me|agents|admin)\//u],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
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
}));
