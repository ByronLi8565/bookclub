import { expect, test, type Locator, type Page } from "@playwright/test";

// Pins the phone swipe contract of the mobile workspace against the React
// entry: pane paging, chrome stepping, and the horizontal-scroller lock that
// keeps a pan inside the PDF from paging the workspace. These are the
// behaviours the Foldkit reader must reproduce with Subscriptions instead of
// react-swipeable.
const HARNESS = "/src/tests/harness/index.html?mobile=1&book=/fixtures/moby-dick.pdf";

async function openWorkspace(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await expect(page.locator(".pdf-page canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle("Increase text size")).toBeEnabled({ timeout: 30_000 });
}

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

const readerPane = (page: Page) => page.locator(".pager-page").first();
const activeTab = (page: Page) => page.locator('.pager-tabs button[aria-pressed="true"]');

test("swiping pages between the reader and the notes pane", async ({ page }) => {
  await openWorkspace(page);
  await expect(activeTab(page)).toHaveAttribute("title", "Show reader");

  await swipe(readerPane(page), "left");
  await expect(page.locator(".harness-notes")).toBeInViewport();
  await expect(activeTab(page)).toHaveAttribute("title", "Show notes");

  await swipe(page.locator(".harness-notes"), "right");
  await expect(readerPane(page)).toBeInViewport();
  await expect(activeTab(page)).toHaveAttribute("title", "Show reader");
});

test("swiping up and down steps the chrome from the reader pane", async ({ page }) => {
  await openWorkspace(page);
  const app = page.locator(".app");

  await swipe(readerPane(page), "up");
  await expect(app).toHaveClass(/app--chrome-hidden/u);

  await swipe(readerPane(page), "down");
  await expect(app).not.toHaveClass(/app--chrome-hidden/u);
});

test("a horizontal pan inside the zoomed PDF does not page the workspace", async ({ page }) => {
  await openWorkspace(page);

  // Zoom until the page is wider than its scroller, which is what makes the
  // scroller a horizontal swipe target the workspace must yield to.
  const scroller = page.locator(".pdf-scroller");
  for (let step = 0; step < 4; step++) await page.getByTitle("Increase text size").click();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollWidth - el.clientWidth), { timeout: 30_000 })
    .toBeGreaterThan(1);

  await swipe(scroller, "left");

  await expect(readerPane(page)).toBeInViewport();
  await expect(activeTab(page)).toHaveAttribute("title", "Show reader");
});
