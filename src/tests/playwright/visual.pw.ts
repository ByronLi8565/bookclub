import { expect, test, type Page } from "@playwright/test";

const MOBY_DICK_READER = "/src/tests/harness/index.html?book=/fixtures/moby-dick.pdf";

async function openExampleReader(page: Page) {
  await page.goto(MOBY_DICK_READER);
  await expect(page.locator(".reader")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".pdf-page canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".reader-page-turn--next")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.locator(".page-count").textContent()).toContain("1 /");
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
}

test("@visual example reader state matches the approved snapshot", async ({ page }) => {
  await openExampleReader(page);

  await expect(page.locator(".reader")).toHaveScreenshot("example-reader.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixels: 0,
    threshold: 0,
  });
});
