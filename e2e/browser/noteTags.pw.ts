import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  authenticateContext,
  BASE_URL,
  joinGroup,
  openWorkspace,
  seedWorkspace,
  selectPdfText,
} from "./browserSupport.ts";

function noteWithBody(page: Page, body: string): Locator {
  return page
    .locator(".note-body")
    .getByText(body, { exact: true })
    .locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' note-result ')][1]",
    );
}

async function beginNote(page: Page): Promise<{ compose: Locator; editor: Locator }> {
  await selectPdfText(page);
  await page.getByTitle("Add a note on this selection").click();
  const compose = page.locator(".note.compose");
  const editor = compose.locator(".note-editor-input");
  await expect(editor).toBeVisible();
  return { compose, editor };
}

async function publishNote(page: Page, text: string, expectedBody: string): Promise<Locator> {
  const { compose, editor } = await beginNote(page);
  await editor.fill("");
  await editor.pressSequentially(text);
  await compose.getByRole("button", { name: "Publish" }).click();
  const note = noteWithBody(page, expectedBody);
  await expect(note, `publishing creates the note body “${expectedBody}”`).toBeVisible({
    timeout: 30_000,
  });
  return note;
}

async function openGeneralSettings(page: Page): Promise<Locator> {
  await page.getByTitle("Settings").click();
  const dialog = page.getByRole("dialog", { name: "settings" });
  await dialog.getByTitle("General settings").click();
  return dialog;
}

async function setNotePreference(page: Page, name: string, checked: boolean): Promise<void> {
  const dialog = await openGeneralSettings(page);
  const checkbox = dialog.getByRole("checkbox", { name });
  if ((await checkbox.isChecked()) !== checked) await checkbox.click();
  await dialog.getByLabel("close").click();
}

function tagLabels(container: Locator): Locator {
  return container.locator(".note-tag > button:first-child");
}

function activeFilter(page: Page, label: string): Locator {
  return page.locator(".note-filter-chip").filter({ hasText: label });
}

test("Note tags · capture, cursor placement, settings, editing, and persistence stay predictable", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);

  const settings = await openGeneralSettings(page);
  await expect(
    settings.getByRole("checkbox", { name: "Hashtags add tags" }),
    "new users get opt-in tag capture by default",
  ).toBeChecked();
  await expect(
    settings.getByRole("checkbox", { name: "Show hashtags" }),
    "captured tags are visible independently",
  ).toBeChecked();
  await settings.getByLabel("close").click();

  const { compose, editor } = await beginNote(page);
  await editor.fill("");
  await editor.pressSequentially("Before #ordinary ##Question ");
  await expect(
    editor,
    "a completed double-hash tag is scooped while a single hash remains prose",
  ).toHaveText("Before #ordinary ");
  await expect(tagLabels(compose)).toHaveText(["question"]);
  await expect(compose.getByText("#question", { exact: true })).toHaveCount(0);

  await editor.pressSequentially("after ##Theme/Identity ");
  await expect(
    editor,
    "typing resumes where the removed tag began instead of jumping elsewhere",
  ).toHaveText("Before #ordinary after ");
  await expect(
    tagLabels(compose),
    "hierarchical tags normalize without a display prefix",
  ).toHaveText(["question", "theme/identity"]);
  await editor.pressSequentially("tail");
  await compose.getByRole("button", { name: "Publish" }).click();

  const original = noteWithBody(page, "Before #ordinary after tail");
  await expect(original).toBeVisible({ timeout: 30_000 });
  await expect(tagLabels(original)).toHaveText(["question", "theme/identity"]);
  await expect(
    original.locator(".note-tag-remove"),
    "read mode never exposes destructive tag controls",
  ).toHaveCount(0);

  await page.reload();
  await openWorkspace(page, ref);
  const persisted = noteWithBody(page, "Before #ordinary after tail");
  await expect(tagLabels(persisted), "tags survive a full server-backed reload").toHaveText([
    "question",
    "theme/identity",
  ]);

  await persisted.getByRole("button", { name: "edit", exact: true }).click();
  const editing = page.locator(".note.editing");
  await expect(
    editing.locator(".note-tag-remove"),
    "delete buttons appear only in edit mode",
  ).toHaveCount(2);
  const labelBox = await tagLabels(editing).first().boundingBox();
  const removeBox = await editing.locator(".note-tag-remove").first().boundingBox();
  if (!labelBox || !removeBox) throw new Error("Editable tag controls have no layout box");
  expect(removeBox.width, "the delete control is a compact square").toBe(20);
  expect(removeBox.height, "the delete control matches the tag height").toBe(20);
  expect(
    Math.abs(labelBox.x + labelBox.width - removeBox.x),
    "the delete square is attached to the tag instead of floating beside it",
  ).toBeLessThanOrEqual(1);

  await editing.getByLabel("Remove #question").click();
  const editBody = editing.locator(".note-editor-input");
  await editBody.press("End");
  await editBody.pressSequentially(" ##edited ");
  await expect(tagLabels(editing)).toHaveText(["edited", "theme/identity"]);
  await editing.getByRole("button", { name: "Save" }).click();
  const edited = noteWithBody(page, "Before #ordinary after tail");
  await expect(edited).toBeVisible({ timeout: 30_000 });
  await expect(
    tagLabels(edited),
    "one save applies tag additions and removals together",
  ).toHaveText(["edited", "theme/identity"]);

  await edited.getByRole("button", { name: "edit", exact: true }).click();
  await page.locator(".note.editing").getByLabel("Remove #edited").click();
  await page.locator(".note.editing").getByRole("button", { name: "Cancel" }).click();
  await expect(
    tagLabels(noteWithBody(page, "Before #ordinary after tail")),
    "cancelling an edit does not remove a tag",
  ).toHaveText(["edited", "theme/identity"]);

  await setNotePreference(page, "Show hashtags", false);
  await expect(
    noteWithBody(page, "Before #ordinary after tail").locator(".note-tag"),
    "tag visibility can be disabled without changing the note",
  ).toHaveCount(0);
  await setNotePreference(page, "Show hashtags", true);
  await expect(tagLabels(noteWithBody(page, "Before #ordinary after tail"))).toHaveText([
    "edited",
    "theme/identity",
  ]);

  await setNotePreference(page, "Hashtags add tags", false);
  const literal = await publishNote(
    page,
    "Literal ##not-a-tag stays in the note",
    "Literal ##not-a-tag stays in the note",
  );
  await expect(
    literal.locator(".note-tag"),
    "disabling capture leaves double-hash text alone and creates no tag",
  ).toHaveCount(0);
});

test("Note tags · filtering supports all, any, exclusion, empty results, and reply context", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);

  const alpha = await publishNote(page, "Alpha only ##question ", "Alpha only");
  await publishNote(page, "Beta only ##joke ", "Beta only");
  await publishNote(page, "Combined ##question ##joke ", "Combined");

  await tagLabels(alpha).getByText("question", { exact: true }).click();
  const questionFilter = activeFilter(page, "question");
  await expect(
    questionFilter.locator("button").first(),
    "filter chips omit the hash prefix",
  ).toHaveText("question");
  await expect(page.getByText("#question", { exact: true })).toHaveCount(0);
  await expect(noteWithBody(page, "Alpha only")).toBeVisible();
  await expect(noteWithBody(page, "Combined")).toBeVisible();
  await expect(noteWithBody(page, "Beta only")).toHaveCount(0);

  const headingBox = await page.getByRole("heading", { name: "Notes" }).boundingBox();
  const scopeBox = await page.getByLabel("Notes scope").boundingBox();
  const termsBox = await page.locator(".note-filter-terms").boundingBox();
  if (!headingBox || !scopeBox || !termsBox) throw new Error("Filter toolbar has no layout box");
  expect(
    Math.abs(scopeBox.y - headingBox.y),
    "book scope stays beside the Notes heading when filters are active",
  ).toBeLessThanOrEqual(6);
  expect(termsBox.y, "selected filters and their controls move to a dedicated row").toBeGreaterThan(
    headingBox.y + headingBox.height,
  );

  const input = page.getByLabel("Filter notes");
  await input.fill("joke");
  const jokeSuggestion = page
    .locator(".note-filter-suggestions button")
    .filter({ hasText: "joke" });
  await expect(jokeSuggestion, "known tags are suggested without a hash prefix").toHaveCount(1);
  await jokeSuggestion.click();
  await expect(
    noteWithBody(page, "Combined"),
    "Match all requires both selected tags",
  ).toBeVisible();
  await expect(noteWithBody(page, "Alpha only")).toHaveCount(0);
  await expect(noteWithBody(page, "Beta only")).toHaveCount(0);

  await page.getByRole("button", { name: "Match all" }).click();
  await expect(page.getByRole("button", { name: "Match any" })).toBeVisible();
  await expect(noteWithBody(page, "Alpha only")).toBeVisible();
  await expect(noteWithBody(page, "Beta only")).toBeVisible();
  await expect(noteWithBody(page, "Combined")).toBeVisible();

  await activeFilter(page, "joke").getByTitle("Include or exclude").click();
  await expect(activeFilter(page, "Not joke")).toBeVisible();
  await expect(
    noteWithBody(page, "Alpha only"),
    "exclusions override Match any inclusions",
  ).toBeVisible();
  await expect(noteWithBody(page, "Beta only")).toHaveCount(0);
  await expect(noteWithBody(page, "Combined")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear" }).click();

  await input.fill("missing-tag");
  await page.getByRole("button", { name: /Create missing-tag filter/u }).click();
  await expect(page.getByText("No notes match these filters.")).toBeVisible();
  await expect(activeFilter(page, "missing-tag").locator("button").first()).toHaveText(
    "missing-tag",
  );
  await activeFilter(page, "missing-tag").getByLabel("Remove missing-tag filter").click();
  await expect(noteWithBody(page, "Alpha only")).toBeVisible();

  const parent = await publishNote(page, "Thread parent ##question ", "Thread parent");
  await parent.getByRole("button", { name: "reply" }).click();
  const reply = page.locator(".reply-compose");
  await reply.locator(".note-editor-input").pressSequentially("Tagged child ##answer ");
  await reply.getByRole("button", { name: "Reply" }).click();
  const child = noteWithBody(page, "Tagged child");
  await expect(child).toBeVisible({ timeout: 30_000 });
  await tagLabels(child).getByText("answer", { exact: true }).click();
  await expect(child, "the matching reply remains visible").toBeVisible();
  await expect(parent, "a matching reply retains its parent as thread context").toBeVisible();
  await expect(parent).toHaveClass(/note-result--context/u);
  await page.getByRole("button", { name: "Clear" }).click();

  await input.fill("Reply");
  const replyProperty = page
    .locator(".note-filter-suggestions button")
    .filter({ hasText: "TypeReply" });
  await replyProperty.click();
  await expect(activeFilter(page, "Type: Reply")).toBeVisible();
  await expect(child).toBeVisible();
  await expect(parent, "property filters preserve the same thread context rules").toBeVisible();

  await page.getByRole("button", { name: "All books" }).click();
  await expect(page.getByRole("button", { name: "All books" })).toHaveClass(/active/u);
  await expect(
    activeFilter(page, "Type: Reply"),
    "scope controls do not join the filter row",
  ).toBeVisible();
});

test("Note tags · additions and removals converge live while another member is filtering", async ({
  browser,
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  const readerContext = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
  });
  try {
    await authenticateContext(readerContext, "tag-reader");
    await joinGroup(page.context(), readerContext, ref);
    const readerPage = await readerContext.newPage();
    await Promise.all([openWorkspace(page, ref), openWorkspace(readerPage, ref)]);

    const ownerNote = await publishNote(page, "Live note ##shared ", "Live note");
    const readerNote = noteWithBody(readerPage, "Live note");
    await expect(readerNote, "the other member receives the tagged note live").toBeVisible({
      timeout: 30_000,
    });
    await expect(tagLabels(readerNote)).toHaveText(["shared"]);

    await tagLabels(readerNote).getByText("shared", { exact: true }).click();
    await expect(activeFilter(readerPage, "shared")).toBeVisible();
    await expect(readerNote).toBeVisible();

    await ownerNote.getByRole("button", { name: "edit", exact: true }).click();
    const editing = page.locator(".note.editing");
    await editing.getByLabel("Remove #shared").click();
    const editor = editing.locator(".note-editor-input");
    await editor.press("End");
    await editor.pressSequentially(" ##revised ");
    await editing.getByRole("button", { name: "Save" }).click();

    await expect(
      readerPage.getByText("No notes match these filters."),
      "removing the tag live removes the note from another member's active filter",
    ).toBeVisible({ timeout: 30_000 });
    await readerPage.getByRole("button", { name: "Clear" }).click();
    const revised = noteWithBody(readerPage, "Live note");
    await expect(revised).toBeVisible();
    await expect(
      tagLabels(revised),
      "the replacement tag arrives through the same live edit",
    ).toHaveText(["revised"]);
  } finally {
    await readerContext.close();
  }
});
