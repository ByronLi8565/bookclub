import { expect, test, type Page } from "@playwright/test";

// Emulates Mobile Safari (see playwright.config.ts) and drives the reader
// harness with a real PDF, guarding the two phone touch interactions: tapping
// the left/right edge to turn pages, and pinching to zoom only the PDF content.
//
// Scope note: Playwright's WebKit emulation does NOT fire iOS `gesture*` events
// (`"ongesturestart" in window` is false) and has no real multitouch, so the
// pinch test below drives the raw two-finger `touchmove` fallback path, not the
// iOS gesture path that runs on a physical iPhone. These tests therefore guard
// the tap + raw-touch-pinch logic against regressions; the iOS-gesture pinch
// behaviour still needs verification on a real device / Safari Web Inspector.
const HARNESS = "/src/tests/harness/index.html?mobile=1&book=/fixtures/moby-dick.pdf";

async function openPdf(page: Page) {
  await page.goto(HARNESS);
  // The page-turn buttons only mount once the PDF is rendered and ready.
  await expect(page.locator(".reader-page-turn--next")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => readPage(page), { timeout: 30_000 }).toBe(1);
}

function readPage(page: Page) {
  return page.locator(".page-count").evaluate((el) => {
    const m = (el.textContent ?? "").match(/(\d+)\s*\/\s*(\d+)/u);
    return m ? Number(m[1]) : null;
  });
}

function readZoom(page: Page) {
  return page.locator(".font-size").evaluate((el) => {
    const m = (el.textContent ?? "").match(/(\d+)/u);
    return m ? Number(m[1]) : null;
  });
}

// Synthesises a two-finger pinch by dispatching Touch events on the scroller,
// matching the raw-touch path the reader uses when gesture events are absent.
async function pinch(page: Page, scale: number) {
  await page.locator(".pdf-scroller").evaluate((el, factor) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // WebKit lacks the `Touch`/`TouchEvent` constructors, so build a plain
    // Event and attach touch-shaped objects the reader's handlers read off.
    const make = (gap: number) => {
      const touch = (x: number) => ({ clientX: x, clientY: cy, target: el });
      return [touch(cx - gap), touch(cx + gap)];
    };
    const fire = (type: string, touches: ReturnType<typeof make>) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: touches });
      Object.defineProperty(event, "targetTouches", { value: touches });
      Object.defineProperty(event, "changedTouches", { value: touches });
      el.dispatchEvent(event);
    };
    const startGap = 40;
    fire("touchstart", make(startGap));
    for (let step = 1; step <= 8; step++) {
      const gap = startGap * (1 + ((factor - 1) * step) / 8);
      fire("touchmove", make(gap));
    }
    fire("touchend", []);
  }, scale);
}

test("tapping the right edge turns the page forward and the left edge turns back", async ({
  page,
}) => {
  await openPdf(page);
  expect(await readPage(page)).toBe(1);

  const size = page.viewportSize()!;
  const midY = size.height / 2;

  // Tap near the right edge — should advance.
  await page.touchscreen.tap(size.width - 10, midY);
  await expect.poll(() => readPage(page)).toBeGreaterThan(1);

  const advanced = (await readPage(page))!;

  // Tap near the left edge — should go back.
  await page.touchscreen.tap(10, midY);
  await expect.poll(() => readPage(page)).toBeLessThan(advanced);
});

test("pinching out zooms the PDF content without changing the page", async ({ page }) => {
  await openPdf(page);
  const startZoom = (await readZoom(page))!;
  const startPage = await readPage(page);

  await pinch(page, 2);

  await expect.poll(() => readZoom(page)).toBeGreaterThan(startZoom);
  // Zooming must not flip the page.
  expect(await readPage(page)).toBe(startPage);
});

test("reader stays interactive when the pdf.js text layer chunk fails to load", async ({
  page,
}) => {
  await page.route(/pdfjs-dist_web_pdf.*viewer.*\.js/u, (route) => route.abort());

  await page.goto(HARNESS);

  // The canvas still paints from the worker render path.
  await expect(page.locator(".pdf-page canvas")).toBeVisible({ timeout: 30_000 });
  // Despite the text layer failing, the reader must become ready: zoom enabled,
  // page-turn mounted, and paging works.
  await expect(page.getByTitle("Increase text size")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator(".reader-page-turn--next")).toBeVisible();
  expect(await readPage(page)).toBe(1);

  await page.getByTitle("Increase text size").click();
  await expect.poll(() => readZoom(page)).toBeGreaterThan(100);
});

const scrollTop = (page: Page) => page.locator(".pdf-scroller").evaluate((el) => el.scrollTop);

test("turning to a new page lands at the top, not the previous page's offset", async ({ page }) => {
  await openPdf(page);

  // Zoom in so the page is taller than the viewport and can be scrolled.
  for (let i = 0; i < 3; i++) await page.getByTitle("Increase text size").click();
  await expect.poll(() => readZoom(page)).toBeGreaterThan(100);

  // Jump to the bottom of the current page so the next edge-tap turns the page
  // (rather than smart-scrolling within it).
  await page.locator(".pdf-scroller").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(50);
  const bottom = await scrollTop(page);
  const before = (await readPage(page))!;

  const size = page.viewportSize()!;
  await page.touchscreen.tap(size.width - 10, size.height / 2);

  await expect.poll(() => readPage(page)).toBeGreaterThan(before);
  // The freshly-entered page must rest at its text-top
  await expect.poll(() => scrollTop(page)).toBeLessThan(bottom - 20);
});

test("the PDF scroller allows tap-and-drag panning in both axes", async ({ page }) => {
  await openPdf(page);
  const touchAction = await page
    .locator(".pdf-scroller")
    .evaluate((el) => getComputedStyle(el).touchAction);
  expect(touchAction).toBe("pan-x pan-y");
});
