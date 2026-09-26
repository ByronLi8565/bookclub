import { expect, test, type Page } from "@playwright/test";

// Older releases installed a caching service worker at /sw.js. The current
// build still serves a worker there, but one whose only job is to retire itself
// and every cache it left, and the app no longer registers one. A regression in
// either half strands a returning reader on a stale application shell.

function registrations(page: Page): Promise<number> {
  return page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
}

test("Deployment · a returning browser's old service worker retires itself", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-card")).toBeVisible();
  expect(await registrations(page), "a fresh load registers no worker").toBe(0);

  // The state an earlier release left behind: its worker registration.
  await page.evaluate(() => navigator.serviceWorker.register("/sw.js"));

  // Only the registration matters to a reader: nothing in the app reads Cache
  // Storage, so a shell cache the retiring worker fails to delete is inert.
  await expect
    .poll(() => registrations(page), {
      message: "the deployed /sw.js unregisters itself",
      timeout: 30_000,
    })
    .toBe(0);

  await page.reload();
  await expect(page.locator(".home-card"), "the reloaded page is the current app").toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
});
