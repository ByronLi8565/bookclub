import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import {
  authenticateContext,
  books,
  currentPage,
  selectPdfText,
  watchForUnexpectedBrowserFailures,
  type GroupSummary,
} from "./browserSupport.ts";

async function uploadThroughUi(
  page: Page,
  kind: keyof typeof books,
  first: boolean,
): Promise<void> {
  if (first) {
    await page.getByTitle("Upload a book or PDF").click();
  } else {
    await page.getByTitle("switch book").click();
    await page.getByTitle("Add a book").click();
  }
  const dialog = page.getByRole("dialog", { name: "add a book" });
  await dialog.locator('input[type="file"]').setInputFiles(fileURLToPath(books[kind].file));
  await expect(dialog.getByRole("heading", { name: "upload info" })).toBeVisible({
    timeout: 30_000,
  });
  await dialog.getByTitle("Upload book").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(books[kind].ready).first()).toBeVisible({ timeout: 30_000 });
}

async function selectEpubText(page: Page): Promise<void> {
  const frame = page.frameLocator(".epub-container iframe").first();
  await frame.locator("body").evaluate((body) => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && (node.textContent?.trim().length ?? 0) < 8) node = walker.nextNode();
    if (!node?.textContent) throw new Error("No selectable EPUB text");
    const start = node.textContent.search(/\S/u);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, Math.min(node.textContent.length, start + 80));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

test("Smoke · common PDF and EPUB reading paths stay free of unexpected errors", async ({
  page,
}) => {
  const assertNoUnexpectedFailures = watchForUnexpectedBrowserFailures(page);
  await authenticateContext(page.context(), "common-paths");
  const created = await page
    .context()
    .request.post("/groups", { data: { displayName: "Common Paths Club" } });
  expect(created.status()).toBe(201);
  // SAFETY: the checked create-group success uses the shared group envelope.
  const { group } = (await created.json()) as { group: GroupSummary };
  const ref = `${group.slug}-${group.publicId}`;

  await page.goto(`/clubs/${ref}`);
  await uploadThroughUi(page, "pdf", true);
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();

  const pdfScroller = page.locator(".pdf-scroller");
  await pdfScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const displacedScrollTop = await pdfScroller.evaluate((element) => element.scrollTop);
  await page.keyboard.press("f");
  await expect
    .poll(() => pdfScroller.evaluate((element) => element.scrollTop), { timeout: 30_000 })
    .toBeLessThan(displacedScrollTop);

  const securityResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/me/passkeys",
  );
  await page.getByRole("button", { name: "settings" }).click();
  expect((await securityResponse).status()).toBe(200);
  await page.getByTitle("Reader settings").click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByTitle("User settings").click();
  await expect(page.locator(".settings-item-head").first()).toHaveCSS(
    "color",
    "rgb(242, 242, 242)",
  );
  await page.keyboard.press("Escape");

  const firstPdfPage = await currentPage(page);
  await page.getByTitle("Next page").click();
  await expect.poll(() => currentPage(page), { timeout: 30_000 }).not.toBe(firstPdfPage);

  await selectPdfText(page);
  await page.getByTitle("Highlight this selection").click();
  await expect(page.locator(".bc-highlight").first()).toBeVisible();

  await selectPdfText(page);
  await page.getByTitle("Add a note on this selection").click();
  const composer = page.locator(".note.compose");
  await composer.locator(".note-editor-input").fill("A smoke-tested reading note.");
  await composer.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("A smoke-tested reading note.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await uploadThroughUi(page, "epub", false);
  await expect(page.locator(".epub-container iframe")).toHaveCount(1);
  const firstEpubPage = await currentPage(page);
  const forward = page.getByTitle("Next page");
  if ((await forward.count()) > 0) {
    await forward.click();
  } else {
    // A reused local fixture may restore at the end; the smoke contract is a
    // successful page turn in either direction, not a particular saved place.
    await page.getByTitle("Previous page").click();
  }
  await expect.poll(() => currentPage(page), { timeout: 30_000 }).not.toBe(firstEpubPage);

  await selectEpubText(page);
  await expect(page.locator(".selection-actions")).toBeVisible({ timeout: 30_000 });
  await page.locator(".reader-bar").click({ position: { x: 2, y: 2 } });
  await expect(page.locator(".selection-actions")).toBeHidden();

  await assertNoUnexpectedFailures();
});
