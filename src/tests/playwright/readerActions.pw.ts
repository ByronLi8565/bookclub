import { expect, test, type Frame, type Page } from "@playwright/test";

const books = [
  { name: "PDF", path: "/fixtures/moby-dick.pdf", ready: ".pdf-page canvas" },
  { name: "EPUB", path: "/fixtures/dorian.epub", ready: ".epub-container iframe" },
] as const;

async function openBook(
  page: Page,
  path: string,
  ready: string,
  options: { chrome?: boolean } = {},
): Promise<void> {
  await page.goto(`/src/tests/harness/index.html?book=${path}${options.chrome ? "&chrome=1" : ""}`);
  await expect(page.locator(ready)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle("Increase text size")).toBeEnabled({ timeout: 30_000 });
}

function currentPage(page: Page): Promise<number | null> {
  return page.locator(".page-count").evaluate((element) => {
    const match = element.textContent?.match(/(\d+)\s*\/\s*(\d+)/u);
    return match ? Number(match[1]) : null;
  });
}

async function selectPdfText(page: Page): Promise<void> {
  await expect(page.locator(".textLayer span").first()).toBeVisible({ timeout: 30_000 });
  await page
    .locator(".textLayer")
    .first()
    .evaluate((layer) => {
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && (node.textContent?.trim().length ?? 0) < 8) node = walker.nextNode();
      if (!node?.textContent) throw new Error("No selectable PDF text");
      const start = node.textContent.search(/\S/u);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, Math.min(node.textContent.length, start + 8));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
}

async function epubFrame(page: Page): Promise<Frame> {
  await expect(page.locator(".epub-container iframe")).toBeVisible({ timeout: 30_000 });
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error("EPUB content frame did not load");
  await frame.locator("body").waitFor();
  return frame;
}

async function selectEpubText(frame: Frame): Promise<void> {
  await frame.locator("body").evaluate((body) => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && (node.textContent?.trim().length ?? 0) < 8) node = walker.nextNode();
    if (!node?.textContent) throw new Error("No selectable EPUB text");
    const start = node.textContent.search(/\S/u);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, Math.min(node.textContent.length, start + 160));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

async function highlightLocator(page: Page) {
  const parentHighlight = page.locator(".bc-highlight").first();
  const contentHighlight = page
    .frameLocator(".epub-container iframe")
    .locator(".bc-highlight")
    .first();
  await expect
    .poll(async () => (await parentHighlight.count()) + (await contentHighlight.count()), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  return (await parentHighlight.count()) > 0 ? parentHighlight : contentHighlight;
}

async function highlightBounds(page: Page): Promise<string> {
  const locator = await highlightLocator(page);
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value)).join(":");
  });
}

for (const book of books) {
  test(`${book.name} supports paging, zoom, and search`, async ({ page }) => {
    await openBook(page, book.path, book.ready);
    await expect(page.locator(".page-count")).toBeVisible({ timeout: 30_000 });
    const firstPage = await currentPage(page);

    await page.getByTitle("Next page").click();
    await expect.poll(() => currentPage(page)).not.toBe(firstPage);
    await page.getByTitle("Previous page").click();
    await expect.poll(() => currentPage(page)).toBe(firstPage);

    const zoom = page.locator(".font-size");
    const initialZoom = await zoom.textContent();
    await page.getByTitle("Increase text size").click();
    await expect(zoom).not.toHaveText(initialZoom ?? "");
    await page.getByTitle("Decrease text size").click();
    await expect(zoom).toHaveText(initialZoom ?? "");

    await page.getByRole("button", { name: "search" }).click();
    await page.getByLabel("Find in book").fill("the");
    await expect(page.locator(".reader-search-count")).not.toHaveText("0 / 0", { timeout: 30_000 });
    await page.getByLabel("Next match").click();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Find in book")).toBeHidden();
  });

  test(`${book.name} redraws a committed highlight when leaving two-page mode`, async ({
    page,
  }) => {
    await openBook(page, book.path, book.ready);
    if (book.name === "PDF") {
      await page.getByTitle("Next page").click();
      await expect.poll(() => currentPage(page)).toBeGreaterThan(1);
    }

    await page.keyboard.press("d");
    if (book.name === "PDF") {
      await expect(page.locator(".pdf-pane")).toHaveCount(2, { timeout: 30_000 });
    }

    const frame = book.name === "EPUB" ? await epubFrame(page) : null;
    if (frame) await selectEpubText(frame);
    else await selectPdfText(page);
    await page.getByTitle("Highlight this selection").click({ timeout: 30_000 });
    const spreadBounds = await highlightBounds(page);
    if (book.name === "EPUB") {
      await (
        await highlightLocator(page)
      ).evaluate((element) => {
        (element as HTMLElement).dataset.beforeLayoutChange = "true";
      });
    }

    await page.keyboard.press("d");
    if (book.name === "PDF") {
      await expect(page.locator(".pdf-pane")).toHaveCount(1, { timeout: 30_000 });
    }
    await expect.poll(() => highlightBounds(page), { timeout: 30_000 }).not.toBe(spreadBounds);
    if (book.name === "EPUB") {
      await expect
        .poll(
          async () =>
            (await highlightLocator(page)).evaluate(
              (element) => (element as HTMLElement).dataset.beforeLayoutChange ?? null,
            ),
          { timeout: 30_000 },
        )
        .toBeNull();
    }
    await expect(await highlightLocator(page)).toBeVisible();
  });
}

test("Z animates the top chrome closed and open", async ({ page }) => {
  await openBook(page, books[0].path, books[0].ready, { chrome: true });
  const topbar = page.locator(".topbar");

  await page.keyboard.press("z");
  await expect(page.locator(".app")).toHaveClass(/app--chrome-hidden/u);
  await expect
    .poll(
      () =>
        topbar.evaluate((element) =>
          element.getAnimations().some((animation) => animation.playState === "running"),
        ),
      { intervals: [5, 10, 20], timeout: 100 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      topbar.evaluate((element) =>
        Math.max(
          ...element
            .getAnimations()
            .map((animation) => Number(animation.effect?.getTiming().duration) || 0),
        ),
      ),
    )
    .toBeGreaterThanOrEqual(200);
  await expect(topbar).toBeHidden();
  await expect(page.locator(".reader-bar")).toBeHidden();

  await page.keyboard.press("z");
  await expect(page.locator(".app")).not.toHaveClass(/app--chrome-hidden/u);
  await expect(topbar).toBeVisible();
});

test("Shift+Up and Shift+Down step through both chrome levels", async ({ page }) => {
  await openBook(page, books[0].path, books[0].ready, { chrome: true });
  const app = page.locator(".app");
  const topbar = page.locator(".topbar");
  const readerBar = page.locator(".reader-bar");

  await page.keyboard.press("Shift+ArrowUp");
  await expect(app).toHaveClass(/app--chrome-hidden/u);
  await expect(topbar).toBeHidden();
  await expect(readerBar).toBeVisible();

  await page.keyboard.press("Shift+ArrowUp");
  await expect(readerBar).toBeHidden();

  await page.keyboard.press("Shift+ArrowDown");
  await expect(topbar).toBeHidden();
  await expect(readerBar).toBeVisible();

  await page.keyboard.press("Shift+ArrowDown");
  await expect(app).not.toHaveClass(/app--chrome-hidden/u);
  await expect(topbar).toBeVisible();
});
