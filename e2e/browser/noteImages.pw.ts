import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openWorkspace, seedWorkspace, selectPdfText } from "./browserSupport.ts";

const PICTURE = new URL("../../assets/icon-192.png", import.meta.url);

/** Pastes a PNG as the clipboard would: a paste event carrying one image file. */
async function pasteImage(editor: Locator): Promise<void> {
  const bytes = [...(await readFile(PICTURE))];
  await editor.evaluate((element, picture) => {
    const data = Uint8Array.from(picture);
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([data], "picture.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
  }, bytes);
}

async function beginNote(page: Page): Promise<{ compose: Locator; editor: Locator }> {
  await selectPdfText(page);
  await page.getByTitle("Add a note on this selection").click();
  const compose = page.locator(".note.compose");
  const editor = compose.locator(".note-editor-input");
  await expect(editor).toBeVisible();
  return { compose, editor };
}

function widthPercent(image: Locator): Promise<number> {
  return image.evaluate((element) => Number(element.style.width.replace(/%$/u, "")));
}

test("Notes · a pasted image uploads, resizes, and publishes at the chosen width", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);
  const { compose, editor } = await beginNote(page);
  await editor.pressSequentially("A note with a picture");

  await pasteImage(editor);
  const image = compose.locator("note-image");
  await expect(image, "the pasted image appears in the draft at once").toHaveCount(1);
  await expect(image.locator("img"), "the uploaded image loads from the club").toHaveJSProperty(
    "complete",
    true,
  );
  await expect(compose.getByRole("button", { name: "Publish" })).toBeEnabled({ timeout: 30_000 });

  const handle = image.getByRole("button", { name: "Resize image" });
  const box = await image.boundingBox();
  const grip = await handle.boundingBox();
  if (!box || !grip) throw new Error("the image widget did not lay out");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - box.width / 2, grip.y + grip.height / 2, { steps: 8 });
  await expect(
    image.locator(".note-editor-image-size"),
    "the drag previews its width",
  ).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => widthPercent(image), { message: "dragging narrows it" }).toBeLessThan(75);

  await handle.focus();
  const dragged = await widthPercent(image);
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() => widthPercent(image), { message: "the arrow keys step the width too" })
    .toBe(dragged - 5);
  const chosen = await widthPercent(image);

  await compose.getByRole("button", { name: "Publish" }).click();
  const published = page
    .locator(".note-result")
    .filter({ hasText: "A note with a picture" })
    .locator("note-image");
  await expect(published, "the image publishes with the note").toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => widthPercent(published), { message: "at the width the author chose" })
    .toBe(chosen);

  await page.reload();
  await openWorkspace(page, ref);
  const reloaded = page
    .locator(".note-result")
    .filter({ hasText: "A note with a picture" })
    .locator("note-image");
  await expect(reloaded).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => widthPercent(reloaded), { message: "the width survives a reload" })
    .toBe(chosen);
  await expect(
    reloaded.locator("img"),
    "a reader who never opened the composer still sees the picture",
  ).toHaveJSProperty("complete", true);
  await expect(
    reloaded.getByRole("button", { name: "Remove image" }),
    "a published image has no editing chrome",
  ).toBeHidden();
});

test("Notes · removing a pasted image takes it out of the note but keeps the text", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);
  const { compose, editor } = await beginNote(page);
  await editor.pressSequentially("Words that stay");

  await pasteImage(editor);
  const image = compose.locator("note-image");
  await expect(compose.getByRole("button", { name: "Publish" })).toBeEnabled({ timeout: 30_000 });
  await image.hover();
  await image.getByRole("button", { name: "Remove image" }).click();
  await expect(image, "the image leaves the draft").toHaveCount(0);

  await compose.getByRole("button", { name: "Publish" }).click();
  const note = page.locator(".note-result").filter({ hasText: "Words that stay" });
  await expect(note, "the text publishes on its own").toBeVisible({ timeout: 30_000 });
  await expect(note.locator("note-image")).toHaveCount(0);
});
