import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  books,
  currentPage,
  epubFrame,
  openWorkspace,
  paintedHighlights,
  seedWorkspace,
  selectEpubText,
  selectPdfText,
} from "./browserSupport.ts";

// The reader inside a real club, against real PDF.js and epub.js. jsdom renders
// neither, so painted highlights, search matches, spreads, pagination, and the
// reader's keyboard all have to be checked here.

type Book = (typeof books)[keyof typeof books];

async function openBook(page: Page, book: Book): Promise<void> {
  const { ref } = await seedWorkspace(page.context(), book);
  await openWorkspace(page, ref, book.ready);
  await expect.poll(() => currentPage(page), { timeout: 30_000 }).not.toBeNull();
}

async function selectText(page: Page, book: Book, passage: number): Promise<void> {
  if (book === books.epub) await selectEpubText(page, passage);
  else await selectPdfText(page);
}

async function turnForward(page: Page): Promise<number | null> {
  const before = await currentPage(page);
  await page.getByTitle("Next page").click();
  await expect.poll(() => currentPage(page), { timeout: 30_000 }).not.toBe(before);
  return currentPage(page);
}

/** Every match the search overlay paints must sit on the matching words of the
 * PDF text layer, not merely somewhere on the page. */
function searchHighlightsOnText(page: Page, query: string): Promise<boolean> {
  return page.locator(".pdf-underlines .bc-search").evaluateAll((highlights, needle) => {
    const textRects: DOMRect[] = [];
    for (const span of document.querySelectorAll(".textLayer span")) {
      const node = span.firstChild;
      const text = node?.textContent ?? "";
      if (!node) continue;
      for (let at = text.toLowerCase().indexOf(needle); at >= 0; ) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        textRects.push(range.getBoundingClientRect());
        at = text.toLowerCase().indexOf(needle, at + needle.length);
      }
    }
    return highlights.some((highlight) => {
      const overlay = highlight.getBoundingClientRect();
      return textRects.some(
        (text) =>
          Math.abs(overlay.left - text.left) < 1 &&
          Math.abs(overlay.width - text.width) < 1 &&
          Math.abs(overlay.top - text.top) < 5,
      );
    });
  }, query);
}

for (const book of [books.pdf, books.epub]) {
  const kind = book === books.pdf ? "PDF" : "EPUB";

  test(`Reader · a ${kind} pages back and forth and search walks its matches`, async ({ page }) => {
    await openBook(page, book);
    const first = await currentPage(page);

    if (book === books.pdf) {
      await expect(
        page.getByTitle("Previous page"),
        "the first page offers nothing to turn back to",
      ).toHaveCount(0);
    }
    await turnForward(page);
    await expect(page.getByTitle("Previous page")).toBeVisible();
    await page.getByTitle("Previous page").click();
    await expect.poll(() => currentPage(page), { timeout: 30_000 }).toBe(first);

    await page.keyboard.press("Meta+f");
    const find = page.getByLabel("Find in book");
    await expect(find).toBeFocused();
    await find.fill("the");
    await find.press("Enter");
    const results = page.getByRole("option");
    await expect.poll(() => results.count(), { timeout: 60_000 }).toBeGreaterThan(3);
    await expect(page.locator(".reader-search-count")).not.toHaveText("0 / 0");
    await expect(results.first().locator("mark"), "each result marks the query").toHaveText(
      /the/iu,
    );
    await results.nth(1).click();
    await expect(results.nth(1)).toHaveAttribute("aria-selected", "true");
    if (book === books.pdf) {
      await expect
        .poll(() => searchHighlightsOnText(page, "the"), {
          message: "the chosen match is painted over its words on the page",
          timeout: 30_000,
        })
        .toBe(true);
    }

    await page.keyboard.press("Meta+f");
    await expect(find).toBeFocused();
    await find.press("Enter");
    await expect(results.nth(2), "Enter steps to the following match").toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByLabel("Next match").click();
    await expect(results.nth(3)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Meta+f");
    await page.keyboard.type("whale");
    await expect(find, "reopening search selects the query, so typing replaces it").toHaveValue(
      "whale",
    );

    await page.keyboard.press("Escape");
    await expect(find).toBeHidden();
  });

  test(`Reader · a ${kind} selection can be let go, or kept as a highlight through a spread change`, async ({
    page,
  }) => {
    await openBook(page, book);
    // A PDF cover stands alone, so the highlight must live on a page a spread still shows.
    if (book === books.pdf) await turnForward(page);

    const popup = page.locator(".selection-actions");
    await selectText(page, book, 0);
    await expect(popup).toBeVisible({ timeout: 30_000 });
    await page.locator(".reader-bar").click({ position: { x: 2, y: 2 } });
    await expect(popup, "a press outside the popup lets the selection go").toBeHidden();

    if (book === books.epub) {
      await selectText(page, book, 1);
      await expect(popup).toBeVisible({ timeout: 30_000 });
      await (await epubFrame(page)).locator("body").click({ force: true });
      await expect(popup, "a press inside the book dismisses the reader's popup").toBeHidden();
    }

    await selectText(page, book, 2);
    await expect(popup).toBeVisible({ timeout: 30_000 });
    await expect(popup.getByTitle("Add a note on this selection")).toBeVisible();
    await popup.getByTitle("Highlight this selection").click();
    await expect(popup, "committing the highlight closes the popup").toBeHidden();
    await expect.poll(() => paintedHighlights(page), { timeout: 30_000 }).toBeGreaterThan(0);

    await page.keyboard.press("d");
    if (book === books.pdf) {
      await expect(page.locator(".pdf-pane"), "d shows two pages side by side").toHaveCount(2, {
        timeout: 30_000,
      });
    }
    await expect
      .poll(() => paintedHighlights(page), {
        message: "the highlight is repainted in the new spread",
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
  });
}

test("Reader · the chrome keys step and toggle the surrounding toolbars", async ({ page }) => {
  await openBook(page, books.pdf);
  const appBar = page.locator(".topbar");
  const readerBar = page.locator(".reader-bar");

  await page.keyboard.press("Shift+ArrowUp");
  await expect(appBar, "the first step hides the app's own bar").toBeHidden();
  await expect(readerBar).toBeVisible();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(readerBar, "the second step hides the reader's bar too").toBeHidden();

  await page.keyboard.press("Shift+ArrowDown");
  await expect(readerBar).toBeVisible();
  await expect(appBar).toBeHidden();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(appBar).toBeVisible();

  await page.keyboard.press("z");
  await expect(readerBar, "z hides both bars at once").toBeHidden();
  await expect(appBar).toBeHidden();
  await page.keyboard.press("z");
  await expect(readerBar, "and z brings both back").toBeVisible();
  await expect(appBar).toBeVisible();
});

test("Reader · an EPUB answers reader keys from inside the book and steps text size by two points", async ({
  page,
}) => {
  await openBook(page, books.epub);
  const frame = await epubFrame(page);
  const body = frame.locator("body");
  // epub.js lays a whole chapter out as one wide document, so a page is one
  // column measured against the part of the book the reader can see.
  const pageWidthShare = () =>
    body.evaluate((element) => {
      const columnWidth = Number(getComputedStyle(element).columnWidth.replace(/px$/u, ""));
      const visible = window.frameElement?.closest(".epub-container")?.clientWidth ?? 0;
      return Number.isFinite(columnWidth) && visible > 0
        ? Math.round((columnWidth / visible) * 100) / 100
        : 1;
    });

  const before = await currentPage(page);
  await body.press("ArrowRight");
  await expect.poll(() => currentPage(page), { timeout: 30_000 }).not.toBe(before);

  await expect
    .poll(pageWidthShare, { message: "a book opens on the default one-page layout" })
    .toBeGreaterThan(0.75);
  // A spread change replaces the content document, so the keyboard has to
  // follow each replacement rather than the one the rendition first opened.
  await body.press("d");
  await expect
    .poll(pageWidthShare, { message: "d shows two pages side by side", timeout: 30_000 })
    .toBeLessThan(0.75);
  await body.press("d");
  await expect.poll(pageWidthShare, { timeout: 30_000 }).toBeGreaterThan(0.75);

  const paragraphSize = () =>
    frame
      .locator("p")
      .first()
      .evaluate((paragraph) => Number(getComputedStyle(paragraph).fontSize.replace(/px$/u, "")));
  await expect(page.locator(".font-size")).toHaveText("16 pt");
  const atSixteen = await paragraphSize();
  await page.getByTitle("Increase text size").click();
  await expect(page.locator(".font-size")).toHaveText("18 pt");
  await expect
    .poll(paragraphSize, { message: "the book's own text grows in proportion" })
    .toBeCloseTo(atSixteen * (18 / 16), 1);
});

/** The page total the reader shows, e.g. 12 in "3 / 12". */
function totalPages(page: Page): Promise<number | null> {
  return page.locator(".page-count").evaluate((element) => {
    const match = element.textContent?.match(/\d+\s*\/\s*(\d+)/u);
    return match ? Number(match[1]) : null;
  });
}

/** How far the painted highlight sits from the words it marks, in pixels.
 * epub.js lays its marks over the book's iframe in the page, so the words'
 * position inside the content document is offset by the iframe's own. */
function highlightDrift(page: Page, passage: string): Promise<number | null> {
  return page
    .locator(books.epub.ready)
    .first()
    .evaluate((frame, text) => {
      // SAFETY: the locator matches the reader's book <iframe> and nothing else.
      const content = (frame as HTMLIFrameElement).contentDocument;
      const marks = [...document.querySelectorAll(".bc-highlight")].map((mark) =>
        mark.getBoundingClientRect(),
      );
      if (!content || marks.length === 0) return null;
      const walker = content.createTreeWalker(content.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(text) ?? -1;
        if (at < 0) continue;
        const range = content.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const words = range.getBoundingClientRect();
        const offset = frame.getBoundingClientRect();
        const top = Math.min(...marks.map((mark) => mark.top));
        const left = Math.min(...marks.map((mark) => mark.left));
        return Math.round(
          Math.hypot(top - (offset.top + words.top), left - (offset.left + words.left)),
        );
      }
      return null;
    }, passage);
}

test("Reader · an EPUB highlight and page count follow the text through text-size and window changes", async ({
  page,
}) => {
  await openBook(page, books.epub);
  await selectEpubText(page, 2);
  const passage = await (
    await epubFrame(page)
  )
    .locator("body")
    .evaluate(() => window.getSelection()?.toString().trim() ?? "");
  await page.locator(".selection-actions").getByTitle("Highlight this selection").click();
  await expect
    .poll(() => highlightDrift(page, passage), { timeout: 30_000 })
    .toBeLessThanOrEqual(4);

  const atSixteen = await totalPages(page);
  await page.getByTitle("Increase text size").click();
  await page.getByTitle("Increase text size").click();
  await expect(page.locator(".font-size")).toHaveText("20 pt");
  await expect
    .poll(() => totalPages(page), {
      message: "larger text is counted again at the new size",
      timeout: 30_000,
    })
    .toBeGreaterThan(atSixteen ?? 0);
  await expect
    .poll(() => highlightDrift(page, passage), {
      message: "the highlight is redrawn on its words after the text reflows",
      timeout: 30_000,
    })
    .toBeLessThanOrEqual(4);

  const atFullWidth = await totalPages(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect
    .poll(() => totalPages(page), {
      message: "a narrower reader is counted again",
      timeout: 30_000,
    })
    .toBeGreaterThan(atFullWidth ?? 0);
  await expect
    .poll(() => highlightDrift(page, passage), {
      message: "the highlight follows its words through a resize",
      timeout: 30_000,
    })
    .toBeLessThanOrEqual(4);
});

test("Reader · an EPUB stays inside the reader as the window narrows, in one- and two-page layouts", async ({
  page,
}) => {
  await openBook(page, books.epub);
  const surface = page.locator(".reader-surface");
  const book = surface.locator(".epub-container");
  const overflow = async (): Promise<number | null> => {
    const [surfaceBox, bookBox] = await Promise.all([surface.boundingBox(), book.boundingBox()]);
    if (!surfaceBox || !bookBox) return null;
    const left = Math.max(0, surfaceBox.x - bookBox.x);
    const right = Math.max(0, bookBox.x + bookBox.width - (surfaceBox.x + surfaceBox.width));
    return Math.round(left + right);
  };

  for (const width of [1100, 860]) {
    await page.setViewportSize({ width, height: 900 });
    for (const layout of ["spread", "single page"]) {
      await expect
        .poll(overflow, { message: `a ${width}px ${layout} stays inside the reader` })
        .toBeLessThanOrEqual(1);
      await page.keyboard.press("d");
      await expect(book).toBeVisible();
    }
  }
});

test("Reader · PDF fit and zoom hold across page turns, and a turn starts at the left edge", async ({
  page,
}) => {
  await openBook(page, books.pdf);
  const scroller = page.locator(".pdf-scroller");
  const zoom = page.locator(".font-size");
  const distanceFromTextTop = () =>
    page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>(".pdf-scroller");
      const spans = [...document.querySelectorAll<HTMLElement>(".textLayer span")];
      if (!viewport || spans.length === 0) return Infinity;
      const viewportTop = viewport.getBoundingClientRect().top;
      const textTop = Math.min(...spans.map((span) => span.getBoundingClientRect().top));
      const expected = Math.max(0, viewport.scrollTop + textTop - viewportTop - 24);
      return Math.round(Math.abs(viewport.scrollTop - expected));
    });
  const scrollToBottom = () =>
    scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });

  await expect(page.locator(".textLayer span").first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(distanceFromTextTop, { message: "a newly opened PDF starts fitted", timeout: 30_000 })
    .toBeLessThanOrEqual(10);
  const displaced = await scrollToBottom();
  expect(displaced, "the fitted page is taller than the viewport").toBeGreaterThan(0);
  await page.keyboard.press("f");
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop), { timeout: 30_000 })
    .toBeLessThan(displaced);

  await turnForward(page);
  await expect
    .poll(distanceFromTextTop, {
      message: "fit is a mode: the next page lands at its own text top",
      timeout: 30_000,
    })
    .toBeLessThanOrEqual(10);

  for (let step = 0; step < 3; step++) {
    const previous = (await zoom.textContent()) ?? "";
    await page.getByTitle("Zoom in").click();
    await expect(zoom, "zooming in leaves fit mode").not.toHaveText(previous);
  }
  const manualZoom = await zoom.textContent();
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth), {
      message: "the zoomed page is wider than the reader",
      timeout: 30_000,
    })
    .toBeGreaterThan(100);
  await scroller.evaluate((element) => {
    element.scrollLeft = 100;
    element.scrollTop = element.scrollHeight;
  });

  await turnForward(page);
  await expect(zoom, "a manual zoom holds across a page turn").toHaveText(manualZoom ?? "");
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollLeft), {
      message: "the new page does not inherit the old page's horizontal pan",
    })
    .toBe(0);
});

test("Reader · reopening a PDF shows the last rendered page while the book downloads", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context(), books.pdf);
  await openWorkspace(page, ref);
  await turnForward(page);
  await expect(page.locator(".pdf-scroller")).toHaveAttribute("data-snapshot-status", "persisted", {
    timeout: 30_000,
  });

  let releaseBook = () => {};
  const bookHeld = new Promise<void>((resolve) => {
    releaseBook = resolve;
  });
  await page.route(
    (url) => url.pathname === `/groups/${ref}/book`,
    async (route) => {
      if (route.request().method() === "GET") await bookHeld;
      await route.continue();
    },
  );
  await page.reload();
  await expect(
    page.locator(".reader-snapshot img"),
    "the remembered page is on screen before the book's bytes arrive",
  ).toBeVisible({ timeout: 30_000 });
  releaseBook();
  await expect(page.locator(books.pdf.ready)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".reader-snapshot img")).toHaveCount(0);
});

/** WebKit has no Touch constructor and Playwright's touchscreen only taps, so a
 * swipe is plain Events carrying touch-shaped objects, dispatched in one turn. */
async function swipe(target: Locator, direction: "left" | "right" | "up" | "down"): Promise<void> {
  await target.evaluate((element, dir) => {
    const travel = 160;
    const rect = element.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;
    const stepX = dir === "left" ? -1 : dir === "right" ? 1 : 0;
    const stepY = dir === "up" ? -1 : dir === "down" ? 1 : 0;
    const fire = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const touches = [{ clientX: x, clientY: y, target: element }];
      // A lifted finger leaves no live touches but reports where it ended.
      const lifted = type === "touchend";
      Object.defineProperty(event, "touches", { value: lifted ? [] : touches });
      Object.defineProperty(event, "targetTouches", { value: lifted ? [] : touches });
      Object.defineProperty(event, "changedTouches", { value: touches });
      element.dispatchEvent(event);
    };
    fire("touchstart", startX, startY);
    for (let step = 1; step <= 8; step++) {
      fire("touchmove", startX + (stepX * travel * step) / 8, startY + (stepY * travel * step) / 8);
    }
    fire("touchend", startX + stepX * travel, startY + stepY * travel);
  }, direction);
}

test("Reader · on a phone, swipes step the chrome and switch panes, but a zoomed PDF pans in place @mobile", async ({
  page,
}) => {
  await openBook(page, books.pdf);
  const surface = page.locator(".reader-surface");
  const showReader = page.getByTitle("Show reader");
  const showNotes = page.getByTitle("Show notes");

  await swipe(surface, "up");
  await expect(page.locator(".topbar"), "swiping up hides the app's bar").toBeHidden();
  await swipe(surface, "down");
  await expect(page.locator(".topbar"), "swiping down brings it back").toBeVisible();

  await swipe(surface, "left");
  await expect(showNotes, "swiping left moves to the notes").toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await swipe(page.locator(".pager-page").last(), "right");
  await expect(showReader, "swiping right returns to the book").toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const scroller = page.locator(".pdf-scroller");
  for (let step = 0; step < 4; step++) await page.getByTitle("Zoom in").click();
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(1);
  await swipe(scroller, "left");
  await expect(
    showReader,
    "a sideways pan inside a zoomed page is not a pane swipe",
  ).toHaveAttribute("aria-pressed", "true");
});
