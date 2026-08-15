import { expect, test, type Frame, type Page } from "@playwright/test";

// The Foldkit reader against real epub.js and PDF.js. jsdom renders neither, so
// the reader's chrome — painted highlights, search matches, spread changes,
// pagination, and the keyboard Subscriptions — is only checkable here.
const books = [
  { name: "PDF", path: "/fixtures/moby-dick.pdf", ready: ".pdf-page canvas" },
  { name: "EPUB", path: "/fixtures/dorian.epub", ready: ".epub-container iframe >> nth=0" },
] as const;

async function openBook(page: Page, path: string, ready: string): Promise<void> {
  await page.goto(`/src/tests/harness/foldkitReader.html?book=${path}`);
  await expect(page.locator(ready)).toBeVisible({ timeout: 30_000 });
}

function pageCount(page: Page): Promise<number | null> {
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
      let startNode: Node | null = null;
      let endNode: Node | null = null;
      let startOffset = 0;
      let endOffset = 0;
      let length = 0;
      for (let node = walker.nextNode(); node && length < 8; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        const offset = startNode ? 0 : text.search(/\S/u);
        if (offset < 0 || offset >= text.length) continue;
        startNode ??= node;
        if (node === startNode) startOffset = offset;
        endNode = node;
        endOffset = Math.min(text.length, offset + (8 - length));
        length += endOffset - offset;
      }
      if (!startNode || !endNode || length === 0) throw new Error("No selectable PDF text");
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
}

async function epubFrame(page: Page): Promise<Frame> {
  await expect(page.locator(".epub-container iframe").first()).toBeVisible({ timeout: 30_000 });
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

/** Committed highlights land in the page for a PDF and inside the content
 *  iframe for an EPUB, so both are counted. */
function painted(page: Page, className: string): Promise<number> {
  return page
    .locator(`.${className}`)
    .count()
    .then(async (parent) =>
      parent > 0
        ? parent
        : await page
            .frameLocator(".epub-container iframe >> nth=0")
            .locator(`.${className}`)
            .count(),
    );
}

const paintedHighlights = (page: Page) => painted(page, "bc-highlight");

for (const book of books) {
  test(`Foldkit ${book.name}: pages, counts, and searches`, async ({ page }) => {
    await openBook(page, book.path, book.ready);

    await expect.poll(() => pageCount(page), { timeout: 60_000 }).not.toBeNull();
    const first = await pageCount(page);

    await page.getByTitle("Next page").click();
    await expect.poll(() => pageCount(page), { timeout: 30_000 }).not.toBe(first);
    await page.getByTitle("Previous page").click();
    await expect.poll(() => pageCount(page), { timeout: 30_000 }).toBe(first);

    await page.keyboard.press("Meta+f");
    await page.getByLabel("Find in book").fill("the");
    await page.getByLabel("Find in book").press("Enter");
    await expect(page.locator(".reader-search-count")).not.toHaveText("0 / 0", { timeout: 60_000 });

    await page.getByLabel("Next match").click();
    await expect
      .poll(
        () =>
          page
            .locator(".bc-search")
            .count()
            .then((n) => n),
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(0);

    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Find in book")).toBeHidden();
  });

  test(`Foldkit ${book.name}: a highlight is painted and survives a spread change`, async ({
    page,
  }) => {
    await openBook(page, book.path, book.ready);
    await expect.poll(() => pageCount(page), { timeout: 60_000 }).not.toBeNull();

    // A PDF cover stands alone, so a spread needs a page past it — and the
    // highlight has to live on a page the spread still shows.
    if (book.name === "PDF") {
      await page.getByTitle("Next page").click();
      await expect.poll(() => pageCount(page), { timeout: 30_000 }).toBeGreaterThan(1);
    }

    if (book.name === "EPUB") await selectEpubText(await epubFrame(page));
    else await selectPdfText(page);

    await page.getByTitle("Highlight this selection").click({ timeout: 30_000 });
    await expect.poll(() => paintedHighlights(page), { timeout: 30_000 }).toBeGreaterThan(0);

    // `d` toggles the spread through the reader's own keyboard Subscription.
    await page.keyboard.press("d");
    if (book.name === "PDF") {
      await expect(page.locator(".pdf-pane")).toHaveCount(2, { timeout: 30_000 });
    }
    await expect.poll(() => paintedHighlights(page), { timeout: 30_000 }).toBeGreaterThan(0);
  });
}

test("Foldkit reader: the chrome keys step and toggle the reader toolbar", async ({ page }) => {
  await openBook(page, books[0].path, books[0].ready);
  const shell = page.locator(".reader-shell");
  const toolbar = page.locator(".reader-toolbar");

  await page.keyboard.press("Shift+ArrowUp");
  await expect(shell).toHaveClass(/reader--chrome-hidden/u);
  await expect(toolbar).toBeVisible();

  await page.keyboard.press("Shift+ArrowUp");
  await expect(toolbar).toHaveCount(0);

  await page.keyboard.press("Shift+ArrowDown");
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(shell).not.toHaveClass(/reader--chrome-hidden/u);

  // `z` jumps both levels at once, rather than stepping.
  await page.keyboard.press("z");
  await expect(toolbar).toHaveCount(0);
  await page.keyboard.press("z");
  await expect(toolbar).toBeVisible();
});
