import { expect, test, type Locator, type Page } from "@playwright/test";

// The reader's swipe contract driven against the Foldkit entry's own
// Subscription rather than react-swipeable: the same thresholds, the same
// deference to a horizontal scroller. readerGestures.pw.ts pins the React
// reader's behaviour these are checked against.
// WebKit has no Touch/TouchEvent constructors and Playwright's touchscreen only
// taps, so a swipe is synthesised the same way pdfMobile.pw.ts synthesises a
// pinch: plain Events carrying touch-shaped objects, dispatched in one turn so
// they land inside react-swipeable's 500ms swipe window.
async function swipe(
  target: Locator,
  direction: "left" | "right" | "up" | "down",
  distance = 160,
): Promise<void> {
  await target.evaluate(
    (element, { direction: dir, distance: travel }) => {
      const rect = element.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      const stepX = dir === "left" ? -1 : dir === "right" ? 1 : 0;
      const stepY = dir === "up" ? -1 : dir === "down" ? 1 : 0;
      const fire = (type: string, x: number, y: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        const touches = [{ clientX: x, clientY: y, target: element }];
        // A real touchend carries no live touches but does report the finger it
        // lifted, which is where a gesture's end coordinates come from.
        const lifted = type === "touchend";
        Object.defineProperty(event, "touches", { value: lifted ? [] : touches });
        Object.defineProperty(event, "targetTouches", { value: lifted ? [] : touches });
        Object.defineProperty(event, "changedTouches", { value: touches });
        element.dispatchEvent(event);
      };
      fire("touchstart", startX, startY);
      for (let step = 1; step <= 8; step++) {
        const progress = (travel * step) / 8;
        fire("touchmove", startX + stepX * progress, startY + stepY * progress);
      }
      fire("touchend", startX + stepX * travel, startY + stepY * travel);
    },
    { direction, distance },
  );
}

// The same swipe contract, driven against the Foldkit reader's own
// Subscription rather than react-swipeable.
const FOLDKIT_HARNESS = "/src/tests/harness/foldkitReader.html?book=/fixtures/moby-dick.pdf";

async function openFoldkitReader(page: Page): Promise<void> {
  await page.goto(FOLDKIT_HARNESS);
  await expect(page.locator(".pdf-page canvas")).toBeVisible({ timeout: 30_000 });
}

test("Foldkit reader: swiping switches pane and steps the chrome", async ({ page }) => {
  await openFoldkitReader(page);
  const app = page.locator(".app");
  const surface = page.locator(".reader-surface");

  await swipe(surface, "up");
  await expect(app).toHaveClass(/app--chrome-hidden/u);

  await swipe(surface, "down");
  await expect(app).not.toHaveClass(/app--chrome-hidden/u);

  await swipe(surface, "left");
  await expect(app).toHaveAttribute("data-pane", "notes");

  await swipe(surface, "right");
  await expect(app).toHaveAttribute("data-pane", "reader");
});

test("Foldkit reader: a horizontal pan inside the zoomed PDF keeps the pane", async ({ page }) => {
  await openFoldkitReader(page);
  const scroller = page.locator(".pdf-scroller");
  for (let step = 0; step < 4; step++) await page.getByTitle("Increase text size").click();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollWidth - el.clientWidth), { timeout: 30_000 })
    .toBeGreaterThan(1);

  await swipe(scroller, "left");

  await expect(page.locator(".app")).toHaveAttribute("data-pane", "reader");
});
