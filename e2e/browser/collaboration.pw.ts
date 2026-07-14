import { expect, test, type Page } from "@playwright/test";
import {
  authenticateContext,
  BASE_URL,
  books,
  joinGroup,
  openWorkspace,
  seedWorkspace,
} from "./browserSupport.ts";

async function selectPdfText(page: Page): Promise<void> {
  await expect(page.locator(".textLayer span").first()).toBeVisible({ timeout: 30_000 });
  await page
    .locator(".textLayer")
    .first()
    .evaluate((layer) => {
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      let startNode: Node | null = null;
      let startOffset = 0;
      let endNode: Node | null = null;
      let endOffset = 0;
      let length = 0;
      for (let node = walker.nextNode(); node && length < 12; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        const offset = startNode ? 0 : text.search(/\S/u);
        if (offset < 0 || offset >= text.length) continue;
        startNode ??= node;
        if (node === startNode) startOffset = offset;
        endNode = node;
        endOffset = Math.min(text.length, offset + (12 - length));
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

test("Collaboration · an invited reader joins and receives the owner's note live", async ({
  browser,
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);

  await page.getByTitle("Show group").click();
  const groupDialog = page.getByRole("dialog", { name: "group" });
  const inviteInput = groupDialog.getByLabel("invite link");
  await expect(inviteInput).not.toHaveValue("");
  const previousLink = await inviteInput.inputValue();
  await groupDialog.getByLabel("regenerate link").click();
  await expect.poll(() => inviteInput.inputValue()).not.toBe(previousLink);
  const inviteLink = new URL(`http://${await inviteInput.inputValue()}`);
  await groupDialog.getByLabel("close").click();

  const readerContext = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
  });
  try {
    await authenticateContext(readerContext, "reader");
    const readerPage = await readerContext.newPage();
    await readerPage.goto(`${inviteLink.pathname}${inviteLink.search}`);
    await expect(readerPage.locator(books.pdf.ready)).toBeVisible({ timeout: 30_000 });
    await expect(readerPage.getByRole("heading", { name: "Notes" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByLabel("2 people online — show group"),
      "both members join the live group room",
    ).toBeVisible({ timeout: 30_000 });

    await selectPdfText(page);
    await page.getByTitle("Add a note on this selection").click();
    const editor = page.locator(".note.compose .note-editor-input");
    await expect(editor).toBeVisible();
    await editor.fill("The owner noticed this passage.");
    await page.locator(".note.compose").getByRole("button", { name: "Publish" }).click();

    await expect(
      readerPage.getByText("The owner noticed this passage.", { exact: true }),
      "the invited reader receives the note without refreshing",
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await readerContext.close();
  }
});

test("Collaboration · reply, edit, and delete converge across two open browsers", async ({
  browser,
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  const readerContext = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
  });
  try {
    await authenticateContext(readerContext, "reader");
    await joinGroup(page.context(), readerContext, ref);
    const readerPage = await readerContext.newPage();
    await Promise.all([openWorkspace(page, ref), openWorkspace(readerPage, ref)]);

    await selectPdfText(page);
    await page.getByTitle("Add a note on this selection").click();
    await page.locator(".note.compose .note-editor-input").fill("Original owner note");
    await page.locator(".note.compose").getByRole("button", { name: "Publish" }).click();
    await expect(readerPage.getByText("Original owner note", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const readerRoot = readerPage
      .locator(".note")
      .filter({ hasText: "Original owner note" })
      .first();
    await readerRoot.getByRole("button", { name: "reply" }).click();
    const reply = readerPage.locator(".reply-compose");
    await reply.locator(".note-editor-input").fill("Reader reply");
    await reply.getByRole("button", { name: "Reply" }).click();
    await expect(
      page.getByText("Reader reply", { exact: true }),
      "the reply reaches the owner live",
    ).toBeVisible({ timeout: 30_000 });

    const ownerRoot = page.locator(".note").filter({ hasText: "Original owner note" }).first();
    await ownerRoot.getByRole("button", { name: "edit" }).click();
    const editing = page.locator(".note.editing");
    await editing.locator(".note-editor-input").fill("Edited owner note");
    await editing.getByRole("button", { name: "Save" }).click();
    await expect(
      readerPage.getByText("Edited owner note", { exact: true }),
      "the owner's edit replaces the reader's live copy",
    ).toBeVisible({ timeout: 30_000 });

    const editedRoot = page.locator(".note").filter({ hasText: "Edited owner note" }).first();
    await editedRoot.getByRole("button", { name: "delete" }).click();
    await editedRoot.getByRole("button", { name: "confirm delete" }).click();
    await expect(
      readerPage.getByText(/This note was deleted on/u),
      "the deleted parent becomes a tombstone in the other browser",
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      readerPage.getByText("Reader reply", { exact: true }),
      "deleting a parent preserves its reply",
    ).toBeVisible();
  } finally {
    await readerContext.close();
  }
});
