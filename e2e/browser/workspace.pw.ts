import { expect, test } from "@playwright/test";
import { books, currentPage, openWorkspace, seedWorkspace } from "./browserSupport.ts";

test("Workspace · a global toast is rendered exactly once", async ({ page }) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);
  await page.route(`**/groups/${ref}/title`, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"failed"}' }),
  );

  await page.getByTitle("Double-click to rename the club").dblclick();
  await page.getByLabel("club name").fill("A rename that will fail");
  await page.getByLabel("club name").press("Enter");

  await expect(page.locator(".toast-viewport")).toHaveCount(1);
  await expect(page.locator(".toast").filter({ hasText: "Rename failed" })).toHaveCount(1);
});

test("Workspace · resize and pane-removal controls preserve a usable layout", async ({ page }) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);

  const split = page.locator(".split");
  const readerPane = split.locator(".split-pane").first();
  const notesPane = split.locator(".split-pane").last();
  const divider = split.locator(".split-divider");
  const splitBox = await split.boundingBox();
  const dividerBox = await divider.boundingBox();
  if (!splitBox || !dividerBox) throw new Error("Workspace split pane has no layout box");

  // The divider is intentionally a zero-width border, so dispatch the press
  // directly and drive the subsequent window-level drag with the real mouse.
  await divider.dispatchEvent("pointerdown", {
    button: 0,
    clientX: dividerBox.x,
    clientY: dividerBox.y + dividerBox.height / 2,
    pointerId: 1,
    pointerType: "mouse",
  });
  await page.mouse.move(splitBox.x + splitBox.width * 0.45, dividerBox.y + dividerBox.height / 2);
  await page.mouse.up();

  await expect
    .poll(async () => {
      const reader = await readerPane.boundingBox();
      const container = await split.boundingBox();
      return reader && container ? reader.width / container.width : null;
    })
    .toBeCloseTo(0.45, 1);
  await expect(readerPane, "dragging keeps the reader available").toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expect(notesPane, "dragging keeps notes available").toHaveAttribute("aria-hidden", "false");

  await page.keyboard.press("Shift+ArrowLeft");
  await expect(readerPane, "removing the left pane expands notes").toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();

  await page.keyboard.press("Shift+ArrowRight");
  await expect(readerPane, "stepping back restores the reader").toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expect(notesPane, "stepping back restores notes").toHaveAttribute("aria-hidden", "false");

  await page.keyboard.press("Shift+ArrowRight");
  await expect(notesPane, "removing the right pane expands the reader").toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator(".pdf-page canvas")).toBeVisible();

  await page.keyboard.press("Shift+ArrowLeft");
  await expect(readerPane, "the split can be restored from reader-only mode").toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expect(notesPane).toHaveAttribute("aria-hidden", "false");
});

test("Workspace · crossing the mobile breakpoint preserves the reader and pane controls", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);

  await page.getByTitle("Next page").click();
  await expect.poll(() => currentPage(page)).toBeGreaterThan(1);
  const readingPage = await currentPage(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".split"), "the desktop shell is removed on a phone").toHaveCount(0);
  await expect(page.locator(".pager"), "the mobile pager replaces it").toBeVisible();
  await expect(page.getByTitle("Show reader")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".pdf-page canvas"), "the open book remains rendered").toBeVisible();
  expect(await currentPage(page), "the current reading page survives the layout change").toBe(
    readingPage,
  );

  await page.getByTitle("Show notes").click();
  await expect(page.getByTitle("Show notes")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await page.getByTitle("Show reader").click();
  await expect(page.locator(".pdf-page canvas")).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator(".split"), "returning to desktop restores both panes").toBeVisible();
  await expect(page.locator(".split-pane")).toHaveCount(2);
  expect(await currentPage(page), "desktop restoration keeps the same reading page").toBe(
    readingPage,
  );
});

test("Workspace · an EPUB remains mounted while crossing the mobile breakpoint", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context(), books.epub);
  await openWorkspace(page, ref, books.epub.ready);

  await page.getByTitle("Next page").click();
  await expect.poll(() => currentPage(page)).toBeGreaterThan(1);
  const readingPage = await currentPage(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".pager")).toBeVisible();
  await expect(page.locator(books.epub.ready), "the EPUB rendition remains attached").toBeVisible();
  expect(await currentPage(page), "the EPUB reading page survives the mobile layout").toBe(
    readingPage,
  );

  await page.getByTitle("Show notes").click();
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await page.getByTitle("Show reader").click();
  await expect(page.locator(books.epub.ready)).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator(".split")).toBeVisible();
  await expect(
    page.locator(books.epub.ready),
    "the EPUB rendition survives desktop restore",
  ).toBeVisible();
  const restoredPage = await currentPage(page);
  expect(restoredPage, "the desktop layout still reports a reading page").not.toBeNull();
  expect(
    Math.abs(restoredPage! - readingPage!),
    "responsive repagination stays at the same EPUB reading location",
  ).toBeLessThanOrEqual(1);
});
