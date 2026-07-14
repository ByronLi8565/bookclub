import { defineConfig, devices } from "@playwright/test";

// Mobile Safari emulation per https://playwright.dev/docs/emulation
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
      testMatch: ["**/pdfMobile.pw.ts", "**/visual.pw.ts"],
      use: { ...devices["iPhone 14"] },
    },
    {
      name: "Desktop Safari",
      testMatch: ["**/readerActions.pw.ts", "e2e/browser/**/*.pw.ts"],
      use: { browserName: "webkit", viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: "vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
