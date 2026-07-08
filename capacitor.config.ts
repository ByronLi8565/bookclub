import type { CapacitorConfig } from "@capacitor/cli";

// Native shell config. We bundle the built SPA (`dist/client`) into the app so
// the shell boots instantly with zero network — the app then talks to the live
// Worker cross-origin (see src/client/logic/net/api.ts + the server CORS
// middleware). `androidScheme: "https"` makes Android's webview origin
// `https://localhost` (avoids mixed-content warnings on the cross-origin API
// calls); iOS uses `capacitor://localhost`. Both origins are allow-listed by
// the Worker's CORS layer.
const config: CapacitorConfig = {
  appId: "land.byron.bookclub",
  appName: "Bookclub",
  webDir: "dist/client",
  server: { androidScheme: "https" },
};

export default config;
