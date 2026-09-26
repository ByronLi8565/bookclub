import { defineConfig, devices } from "@playwright/test";
import { targetBaseUrl } from "./e2e/src/ports.ts";

// A launchd session that is not attached to the user's GUI session refuses the
// mach service registration Chromium's multi-process startup does, and the
// browser aborts before it opens a page. Single-process startup skips that
// registration. Set PW_DETACHED_SESSION=1 to run there; leave it unset in CI and
// in a normal terminal, where multi-process is faster and closer to production.
const detachedSession = !!process.env.PW_DETACHED_SESSION;
const chromiumLaunch = detachedSession ? { args: ["--single-process", "--no-zygote"] } : {};
const desktop = { width: 1280, height: 900 };

// Journeys run against the built client on a fresh e2e worker
// (e2e/setup/browser.globalsetup.ts), never a developer's dev server, and every
// journey mints its own identities, so they are safe to run in parallel.
export default defineConfig({
  testDir: "e2e/browser",
  testMatch: "**/*.pw.ts",
  globalSetup: "./e2e/setup/browser.globalsetup.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: process.env.CI ? 2 : "50%",
  reporter: [["list"]],
  use: { baseURL: targetBaseUrl("browser"), trace: "retain-on-failure" },
  projects: [
    {
      name: "Desktop Safari",
      grepInvert: /@mobile|@chromium|@perf/u,
      use: { browserName: "webkit", viewport: desktop },
    },
    { name: "Mobile Safari", grep: /@mobile/u, use: { ...devices["iPhone 14"] } },
    {
      // WebKit drops the Secure session cookie over local http, so journeys that
      // sign in through the UI itself run on Chromium, which treats loopback as secure.
      name: "Desktop Chrome",
      grep: /@chromium/u,
      use: { browserName: "chromium", viewport: desktop, launchOptions: chromiumLaunch },
    },
    // Performance measurement is a separate gate that `bun run test:perf` opts into.
    ...(process.env.READER_PERF === "1"
      ? [
          {
            name: "Performance",
            grep: /@perf/u,
            use: { browserName: "webkit" as const, viewport: desktop },
          },
        ]
      : []),
  ],
});
