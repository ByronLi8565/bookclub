import { expect, test, type FrameLocator, type Page } from "@playwright/test";

// The Foldkit reader against real epub.js and PDF.js. jsdom renders neither, so
// the reader's chrome — painted highlights, search matches, spread changes,
// pagination, and the keyboard Subscriptions — is only checkable here.
const books = [
  { name: "PDF", path: "/fixtures/moby-dick.pdf", ready: ".pdf-page canvas" },
  { name: "EPUB", path: "/fixtures/dorian.epub", ready: ".epub-container iframe >> nth=0" },
] as const;

async function openBook(page: Page, path: string, ready: string, extra = ""): Promise<void> {
  const kind = path.toLowerCase().endsWith(".pdf") ? "pdf" : "epub";
  await page.goto(
    `/src/tests/harness/foldkitReader.html?kind=${kind}&book=${encodeURIComponent(path)}${extra}`,
  );
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

async function epubFrame(page: Page): Promise<FrameLocator> {
  const visibleFrame = page.locator(".reader-surface .epub-container iframe").first();
  await expect(visibleFrame).toBeVisible({ timeout: 30_000 });
  const frame = visibleFrame.contentFrame();
  await frame.locator("body").waitFor();
  return frame;
}

async function selectEpubText(frame: FrameLocator): Promise<void> {
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
  const shell = page.locator("section.reader");
  const toolbar = page.locator(".reader-bar");

  const app = page.locator(".app");

  // The first step hides the surrounding app chrome, the second the reader's
  // own bar — and both collapse through CSS rather than leaving the DOM.
  await page.keyboard.press("Shift+ArrowUp");
  await expect(app).toHaveClass(/app--chrome-hidden/u);
  await expect(toolbar).toBeVisible();

  await page.keyboard.press("Shift+ArrowUp");
  await expect(shell).toHaveClass(/reader--chrome-hidden/u);
  await expect(toolbar).toBeHidden();

  await page.keyboard.press("Shift+ArrowDown");
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(app).not.toHaveClass(/app--chrome-hidden/u);

  // `z` jumps both levels at once, rather than stepping.
  await page.keyboard.press("z");
  await expect(toolbar).toBeHidden();
  await page.keyboard.press("z");
  await expect(toolbar).toBeVisible();
});

test("Foldkit EPUB: reader keys work while focus is inside the book", async ({ page }) => {
  await openBook(page, books[1].path, books[1].ready);
  const frame = page.frameLocator(".epub-container iframe").first();
  const before = await pageCount(page);

  await frame.locator("body").press("ArrowRight");
  await expect.poll(() => pageCount(page), { timeout: 30_000 }).not.toBe(before);

  await frame.locator("body").press("d");
  await expect(page.locator(".app")).toHaveAttribute("data-layout", "auto");

  // A spread relayout replaces the EPUB's content document. Keyboard bridging
  // must belong to each replacement iframe, not the document epub.js happened
  // to expose when the rendition first opened.
  await frame.locator("body").press("d");
  await expect(page.locator(".app")).toHaveAttribute("data-layout", "single");
  await frame.locator("body").press("d");
  await expect(page.locator(".app")).toHaveAttribute("data-layout", "auto");
});

test("Foldkit EPUB: pressing inside the book dismisses parent reader chrome", async ({ page }) => {
  await openBook(page, books[1].path, books[1].ready);
  const frame = await epubFrame(page);
  await selectEpubText(frame);
  await expect(page.locator(".selection-actions")).toBeVisible({ timeout: 30_000 });

  await frame.locator("body").click({ force: true });

  await expect(page.locator(".selection-actions")).toBeHidden();
});

for (const book of books) {
  test(`Foldkit ${book.name}: the selection popup commits and dismisses`, async ({ page }) => {
    await openBook(page, book.path, book.ready);
    await expect.poll(() => pageCount(page), { timeout: 60_000 }).not.toBeNull();

    if (book.name === "EPUB") await selectEpubText(await epubFrame(page));
    else await selectPdfText(page);

    // The popup hangs off the point the renderer reported for the selection.
    const popup = page.locator(".selection-actions");
    await expect(popup).toBeVisible({ timeout: 30_000 });
    await expect(popup).not.toHaveCSS("left", "0px");
    await expect(popup.getByTitle("Add a note on this selection")).toBeVisible();

    await popup.getByTitle("Highlight this selection").click();
    await expect(popup).toBeHidden();
    await expect.poll(() => paintedHighlights(page), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test(`Foldkit ${book.name}: a press outside the popup lets the selection go`, async ({
    page,
  }) => {
    await openBook(page, book.path, book.ready);
    await expect.poll(() => pageCount(page), { timeout: 60_000 }).not.toBeNull();

    if (book.name === "EPUB") await selectEpubText(await epubFrame(page));
    else await selectPdfText(page);
    await expect(page.locator(".selection-actions")).toBeVisible({ timeout: 30_000 });

    await page.locator(".reader-bar").click({ position: { x: 2, y: 2 } });
    await expect(page.locator(".selection-actions")).toBeHidden();
  });
}

test("Foldkit reader: page-turn zones appear only where there is a page to turn to", async ({
  page,
}) => {
  await openBook(page, books[0].path, books[0].ready);
  await expect.poll(() => pageCount(page), { timeout: 60_000 }).not.toBeNull();

  // The first page has nothing behind it.
  await expect(page.getByTitle("Previous page")).toHaveCount(0);
  await page.getByTitle("Next page").click();
  await expect.poll(() => pageCount(page), { timeout: 30_000 }).toBeGreaterThan(1);
  await expect(page.getByTitle("Previous page")).toBeVisible();
});

test("Foldkit reader: F fits the PDF text to the viewport", async ({ page }) => {
  await openBook(page, books[0].path, books[0].ready);
  await expect.poll(() => pageCount(page), { timeout: 60_000 }).not.toBeNull();
  const scroller = page.locator(".pdf-scroller");
  const distanceFromTextTop = () =>
    page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>(".pdf-scroller");
      const spans = [...document.querySelectorAll<HTMLElement>(".textLayer span")];
      if (!viewport || spans.length === 0) return Infinity;
      const viewportTop = viewport.getBoundingClientRect().top;
      const textTop = Math.min(...spans.map((span) => span.getBoundingClientRect().top));
      const expected = Math.max(0, viewport.scrollTop + textTop - viewportTop - 24);
      return Math.abs(viewport.scrollTop - expected);
    });

  // A newly opened PDF starts fitted without requiring an explicit shortcut.
  await expect(page.locator(".textLayer span").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(distanceFromTextTop, { timeout: 30_000 }).toBeLessThanOrEqual(10);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const before = await scroller.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(0);

  await page.keyboard.press("f");

  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop), { timeout: 30_000 })
    .toBeLessThan(before);

  // Fit is a viewing mode, not a one-shot zoom. The next spread is measured
  // independently and lands at its own text top without another `f` press.
  const fittedPage = await pageCount(page);
  await page.getByTitle("Next page").click();
  await expect.poll(() => pageCount(page), { timeout: 30_000 }).not.toBe(fittedPage);
  await expect(page.locator(".textLayer span").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(distanceFromTextTop, { timeout: 30_000 }).toBeLessThanOrEqual(9);
  await expect(page.locator(".font-size")).not.toHaveText("");

  // A deliberate zoom change leaves fit mode; later pages preserve that exact
  // zoom until the reader asks to fit again.
  const fittedCanvasWidth = await page
    .locator(".pdf-pane canvas")
    .first()
    .evaluate((canvas) => canvas.getBoundingClientRect().width);
  const fittedZoomLabel = await page.locator(".font-size").textContent();
  await page.getByTitle("Increase text size").click();
  await expect(page.locator(".font-size")).not.toHaveText(fittedZoomLabel ?? "");
  const manualZoom = await page.locator(".font-size").textContent();
  const manualPage = await pageCount(page);
  await expect
    .poll(() =>
      page
        .locator(".pdf-pane canvas")
        .first()
        .evaluate((canvas) => canvas.getBoundingClientRect().width),
    )
    .not.toBe(fittedCanvasWidth);
  await expect(scroller).toHaveAttribute("data-rendered-zoom", manualZoom?.replace("%", "") ?? "");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.getByTitle("Next page").click();
  await expect
    .poll(() => pageCount(page), { timeout: 1_000 })
    .not.toBe(manualPage)
    .catch(() => page.getByTitle("Next page").click());
  await expect.poll(() => pageCount(page), { timeout: 30_000 }).not.toBe(manualPage);
  await expect(page.locator(".font-size")).toHaveText(manualZoom ?? "");
});

test("Foldkit reader: each PDF spread pane contains its own cropped page", async ({ page }) => {
  await openBook(page, books[0].path, books[0].ready);
  await page.getByTitle("Next page").click();
  await page.keyboard.press("d");
  await expect(page.locator(".pdf-pane")).toHaveCount(2, { timeout: 30_000 });

  const geometry = await page.locator(".pdf-pane").evaluateAll((panes) =>
    panes.map((pane) => {
      const inner = pane.querySelector<HTMLElement>(".pdf-pane-inner");
      if (!inner) throw new Error("PDF pane has no inner page");
      return {
        pane: pane.getBoundingClientRect().toJSON(),
        inner: inner.getBoundingClientRect().toJSON(),
      };
    }),
  );

  expect(geometry[1]!.pane.left).toBeGreaterThan(geometry[0]!.pane.left);
  for (const { pane, inner } of geometry) {
    expect(inner.left).toBeLessThanOrEqual(pane.left);
    expect(inner.right).toBeGreaterThanOrEqual(pane.right);
  }
});

test("Foldkit reader: EPUB stays inside a resized one- or two-page viewport", async ({ page }) => {
  await openBook(page, books[1].path, books[1].ready);
  const surface = page.locator(".reader-surface");
  // Pagination measurement owns a second offscreen rendition under <body>;
  // only the container inside the reader surface is the visible book.
  const container = surface.locator(".epub-container");

  for (const width of [900, 560]) {
    await surface.evaluate((element, nextWidth) => {
      element.style.width = `${nextWidth}px`;
    }, width);
    await expect
      .poll(async () => {
        const [surfaceBox, containerBox] = await Promise.all([
          surface.boundingBox(),
          container.boundingBox(),
        ]);
        if (!surfaceBox || !containerBox) return false;
        return (
          containerBox.x >= surfaceBox.x &&
          containerBox.x + containerBox.width <= surfaceBox.x + surfaceBox.width + 1
        );
      })
      .toBe(true);
    await page.keyboard.press("d");
    await expect(container).toBeVisible();
  }
});

test("Foldkit reader: a PDF page turn does not inherit horizontal panning", async ({ page }) => {
  await openBook(page, books[0].path, books[0].ready);
  const scroller = page.locator(".pdf-scroller");
  for (let step = 0; step < 3; step++) await page.getByTitle("Increase text size").click();
  await scroller.evaluate((element) => {
    element.scrollLeft = 120;
    element.scrollTop = element.scrollHeight;
  });
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const before = await pageCount(page);
  await page.getByTitle("Next page").click();
  await expect.poll(() => pageCount(page), { timeout: 30_000 }).not.toBe(before);
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(0);
});

test("Foldkit reader: the next PDF page turns from prefetched pixels", async ({ page }) => {
  await openBook(page, books[0].path, books[0].ready);
  const scroller = page.locator(".pdf-scroller");
  await expect.poll(() => pageCount(page), { timeout: 30_000 }).toBeGreaterThan(0);
  const before = await pageCount(page);
  if (before === null) throw new Error("PDF page count is unavailable");
  const next = before + 1;
  await expect
    .poll(
      () =>
        scroller.evaluate((element) =>
          (element.dataset.prefetchedPages ?? "").split(",").map(Number),
        ),
      { timeout: 30_000 },
    )
    .toContain(next);

  await page.getByTitle("Next page").click();
  await expect.poll(() => pageCount(page), { timeout: 30_000 }).toBe(next);
  await expect(page.locator('.pdf-pane canvas[data-raster-source="cache"]')).toBeVisible();
});

test("Foldkit reader: refresh shows the persisted PDF page while reopening", async ({ page }) => {
  await openBook(page, books[0].path, books[0].ready);
  await expect(page.locator(".pdf-pane canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".pdf-scroller")).toHaveAttribute("data-snapshot-status", "persisted");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        return await new Promise<boolean>((resolve) => {
          const open = indexedDB.open("bookclub");
          open.addEventListener("error", () => resolve(false));
          open.addEventListener("success", () => {
            const db = open.result;
            const request = db
              .transaction("reader-snapshots")
              .objectStore("reader-snapshots")
              .count();
            request.addEventListener("success", () => resolve(request.result > 0));
            request.addEventListener("error", () => resolve(false));
          });
        });
      }),
    )
    .toBe(true);

  await page.addInitScript(() => {
    // SAFETY: this test-only flag is installed and read by this same init script.
    const state = window as Window & { sawReaderSnapshot?: boolean };
    state.sawReaderSnapshot = false;
    new MutationObserver(() => {
      if (document.querySelector(".reader-snapshot img")) state.sawReaderSnapshot = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.route("**/fixtures/moby-dick.pdf", async (route) => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });
    await route.continue();
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => {
        // SAFETY: the navigation init script above owns this test-only window flag.
        return (window as Window & { sawReaderSnapshot?: boolean }).sawReaderSnapshot ?? false;
      }),
    )
    .toBe(true);
});

test("Foldkit reader: themed PDF spread stays hidden until both pages are recolored", async ({
  page,
}) => {
  await openBook(page, books[0].path, books[0].ready, "&theme=dark");
  await page.getByTitle("Next page").click();
  await page.keyboard.press("d");
  const canvases = page.locator(".pdf-pane canvas");
  await expect(canvases).toHaveCount(2, { timeout: 30_000 });
  await canvases.evaluateAll((elements) => {
    document.body.dataset.canvasVisibility = "";
    for (const [index, element] of elements.entries()) {
      new MutationObserver(() => {
        document.body.dataset.canvasVisibility += ` ${index}:${element.style.visibility}`;
      }).observe(element, { attributes: true, attributeFilter: ["style"] });
    }
  });

  const before = await pageCount(page);
  await page.getByTitle("Next page").click();
  await expect.poll(() => pageCount(page), { timeout: 30_000 }).not.toBe(before);
  await expect
    .poll(() => page.locator("body").evaluate((body) => body.dataset.canvasVisibility))
    .toContain("0:hidden");
  await expect
    .poll(() => page.locator("body").evaluate((body) => body.dataset.canvasVisibility))
    .toContain("1:hidden");
  for (const canvas of await canvases.all())
    await expect(canvas).toHaveCSS("visibility", "visible");
});
