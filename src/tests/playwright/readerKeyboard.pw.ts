import { expect, test, type Page } from "@playwright/test";

// Pins the reader's keyboard and motion contract against the React entry so the
// Foldkit Subscriptions that replace @tanstack/react-hotkeys have something to
// be checked against. Chrome-stepping keys are covered in readerActions.pw.ts.
const HARNESS = "/src/tests/harness/index.html?chrome=1&book=/fixtures/moby-dick.pdf";

async function openReader(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await expect(page.locator(".pdf-page canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle("Increase text size")).toBeEnabled({ timeout: 30_000 });
}

test("Mod+F opens find-in-book and Escape closes it", async ({ page }) => {
  await openReader(page);
  const find = page.getByLabel("Find in book");
  await expect(find).toBeHidden();

  await page.keyboard.press("Meta+f");
  await expect(find).toBeVisible();
  await expect(find).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(find).toBeHidden();
});

test("the reader toolbar exposes every control by accessible name", async ({ page }) => {
  await openReader(page);

  for (const title of ["Increase text size", "Decrease text size", "Next page"]) {
    await expect(page.getByTitle(title)).toBeEnabled();
  }
  // Backwards paging is offered only once there is a page to go back to.
  await expect(page.getByTitle("Previous page")).toHaveCount(0);
  await page.getByTitle("Next page").click();
  await expect(page.getByTitle("Previous page")).toBeEnabled();

  await page.keyboard.press("Meta+f");
  for (const label of ["Previous match", "Next match", "Close search"]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
});

function chromeAnimationDuration(page: Page): Promise<number> {
  return page
    .locator(".topbar")
    .evaluate((element) =>
      Math.max(
        0,
        ...element
          .getAnimations()
          .map((animation) => Number(animation.effect?.getTiming().duration) || 0),
      ),
    );
}

test.describe("with reduced motion requested", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("Z still hides the chrome, without the collapse animation", async ({ page }) => {
    await openReader(page);

    await page.keyboard.press("z");
    await expect(page.locator(".app")).toHaveClass(/app--chrome-hidden/u);
    // The collapse duration collapses to 1ms (styles/base.css), so the chrome
    // arrives hidden rather than travelling there.
    await expect.poll(() => chromeAnimationDuration(page)).toBeLessThan(50);
    await expect(page.locator(".topbar")).toBeHidden();

    await page.keyboard.press("z");
    await expect(page.locator(".app")).not.toHaveClass(/app--chrome-hidden/u);
    await expect(page.locator(".topbar")).toBeVisible();
  });
});
