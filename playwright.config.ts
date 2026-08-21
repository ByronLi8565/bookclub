import { defineConfig, devices } from "@playwright/test";

// Mobile Safari emulation per https://playwright.dev/docs/emulation

// A launchd session that is not attached to the user's GUI session refuses the
// mach service registration Chromium's multi-process startup does, and the
// browser aborts before it opens a page. Single-process startup skips that
// registration. Set PW_DETACHED_SESSION=1 to run there; leave it unset in CI and
// in a normal terminal, where multi-process is faster and closer to production.
const detachedSession = !!process.env.PW_DETACHED_SESSION;
const chromiumLaunch = detachedSession ? { args: ["--single-process", "--no-zygote"] } : {};

export default defineConfig({
  testDir: ".",
  testMatch: ["src/tests/playwright/**/*.pw.ts", "e2e/browser/**/*.pw.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", trace: "on-first-retry" },
  projects: [
    {
      name: "Mobile Safari",
      testMatch: ["**/foldkitReaderGestures.pw.ts"],
      use: { ...devices["iPhone 14"] },
    },
    {
      name: "Desktop Safari",
      testMatch: ["**/foldkitReader.pw.ts", "**/foldkitComposer.pw.ts", "e2e/browser/**/*.pw.ts"],
      use: { browserName: "webkit", viewport: { width: 1280, height: 900 } },
    },
    {
      // The whole-application checks are about the client and the worker
      // agreeing, not about a rendering engine's quirks, so they run on Chromium
      // — which is also the engine that still starts in a detached session.
      name: "Desktop Chrome",
      testMatch: ["**/foldkitApp.pw.ts"],
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 900 },
        launchOptions: chromiumLaunch,
      },
    },
  ],
  webServer: {
    command: "vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
