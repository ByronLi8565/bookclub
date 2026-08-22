import { expect, test, type Page } from "@playwright/test";

// The note image widget inside a real Lexical editor. Its pointer drag, its
// pointer capture, and the write back into the document are browser behaviour;
// the jsdom tests cover the widget's contract, this covers it working.
const IMAGE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const HARNESS = `/src/tests/harness/foldkitComposer.html?image=${IMAGE_ID}`;

async function openComposer(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await expect(page.locator("note-image")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("pre[data-draft]")).toContainText(`[[image:${IMAGE_ID}]]`);
}

const draft = (page: Page) => page.locator("pre[data-draft]").textContent();

test("dragging the handle resizes the image and writes the new width into the note", async ({
  page,
}) => {
  await openComposer(page);
  const widget = page.locator("note-image");
  const handle = widget.getByTitle(/^Resize image/u);

  const box = await widget.boundingBox();
  const grip = await handle.boundingBox();
  if (!box || !grip) throw new Error("the image widget did not lay out");

  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  // Half the widget's width to the left is a visible, deterministic change.
  await page.mouse.move(grip.x - box.width / 2, grip.y + grip.height / 2, { steps: 8 });
  // Mid-drag the widget previews the width it would commit.
  await expect(widget.locator(".note-editor-image-size")).toBeVisible();
  await page.mouse.up();

  // The width the drag ended on is now part of the note, not just the widget.
  await expect
    .poll(() => draft(page), { timeout: 10_000 })
    .toMatch(new RegExp(String.raw`\[\[image:${IMAGE_ID}:\d{2}\]\]`, "u"));
  const width = await widget.evaluate((element) => element.style.width);
  // `width` is a CSS length like "45px"; `Number()` would yield NaN on the unit.
  // oxlint-disable-next-line unicorn/prefer-number-coercion
  expect(Number.parseInt(width, 10)).toBeLessThan(100);
});

test("the arrow keys resize the image from the handle", async ({ page }) => {
  await openComposer(page);
  const handle = page.locator("note-image").getByTitle(/^Resize image/u);

  await handle.focus();
  await page.keyboard.press("ArrowLeft");

  await expect.poll(() => draft(page), { timeout: 10_000 }).toContain(`[[image:${IMAGE_ID}:95]]`);
});

test("removing the image takes it out of the note", async ({ page }) => {
  await openComposer(page);

  // The chrome only takes pointers while the image is hovered, as it does for
  // the React reader.
  await page.locator("note-image").hover();
  await page.locator("note-image").getByTitle("Remove image").click();

  await expect(page.locator("note-image")).toHaveCount(0);
  await expect.poll(() => draft(page), { timeout: 10_000 }).not.toContain("[[image:");
  // The rest of the note survives the removal.
  await expect.poll(() => draft(page)).toContain("a note");
});
