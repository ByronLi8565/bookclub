import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import {
  authenticateContext,
  BASE_URL,
  joinGroup,
  openWorkspace,
  seedWorkspace,
  books,
  uploadBook,
} from "./browserSupport.ts";

function epubWithNavigationOnlyCover(): Buffer {
  const text = (value: string) => strToU8(value);
  return Buffer.from(
    zipSync({
      mimetype: [text("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": text(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
      "OEBPS/content.opf": text(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">navigation-only-cover</dc:identifier>
    <dc:title>Navigation-only cover</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover" linear="no"/>
    <itemref idref="title"/>
    <itemref idref="chapter"/>
  </spine>
</package>`),
      "OEBPS/toc.ncx": text(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="navigation-only-cover"/></head>
  <docTitle><text>Navigation-only cover</text></docTitle>
  <navMap>
    <navPoint id="cover" playOrder="1">
      <navLabel><text>Cover</text></navLabel><content src="cover.xhtml"/>
    </navPoint>
    <navPoint id="title" playOrder="2">
      <navLabel><text>Title</text></navLabel><content src="title.xhtml"/>
    </navPoint>
    <navPoint id="chapter" playOrder="3">
      <navLabel><text>Chapter</text></navLabel><content src="chapter.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`),
      "OEBPS/cover.xhtml": text(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head>
<body><p>Navigation-only cover</p></body></html>`),
      "OEBPS/title.xhtml": text(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Title</title></head>
<body><h1>Linear reading start</h1></body></html>`),
      "OEBPS/chapter.xhtml": text(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head>
<body><h1>Chapter one</h1></body></html>`),
    }),
  );
}

test("Group roles · an owner demotes a member and the live roster reflects it", async ({
  browser,
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  const memberContext = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const member = await authenticateContext(memberContext, "member");
    await joinGroup(page.context(), memberContext, ref);
    const memberPage = await memberContext.newPage();
    await Promise.all([openWorkspace(page, ref), openWorkspace(memberPage, ref)]);

    await page.getByTitle("Show group").click();
    const ownerDialog = page.getByRole("dialog", { name: "group" });
    const memberRow = ownerDialog.locator("li").filter({ hasText: member.email });
    await memberRow.getByLabel(`Change role for ${member.name}`).click();
    await memberRow.getByTitle("Change role to visitor").click();
    await memberRow.getByRole("button", { name: "confirm role change" }).click();
    await expect(
      memberRow.locator(".invite-person-role"),
      "the owner's roster shows the new role",
    ).toContainText("visitor");

    await memberPage.getByTitle("Show group").click();
    const memberDialog = memberPage.getByRole("dialog", { name: "group" });
    const ownRow = memberDialog.locator("li").filter({ hasText: member.email });
    await expect(
      ownRow.locator(".invite-person-role"),
      "the connected member sees their demotion without refreshing",
    ).toContainText("visitor", { timeout: 30_000 });

    const forbiddenUpload = await memberContext.request.post(`/groups/${ref}/images`, {
      data: Uint8Array.from([1, 2, 3]),
      headers: { "Content-Type": "image/png" },
    });
    expect(forbiddenUpload.status(), "the demoted visitor immediately loses write access").toBe(
      403,
    );
  } finally {
    await memberContext.close();
  }
});

test("Library · deleting the open book requires its title and opens the remaining book", async ({
  page,
}) => {
  const { ref, sourceId } = await seedWorkspace(page.context());
  await uploadBook(page.context(), ref, books.epub);
  await openWorkspace(page, ref);

  await page.getByTitle("Show group").click();
  const groupDialog = page.getByRole("dialog", { name: "group" });
  await groupDialog.getByTitle("Book club library").click();
  const bookRow = groupDialog.locator(".group-books-list li").filter({ hasText: books.pdf.title });
  await bookRow.getByLabel(`Delete ${books.pdf.title}`).click();
  await bookRow.getByRole("button", { name: "confirm delete" }).click();

  const deleteDialog = page.getByRole("dialog", { name: "delete book" });
  const titleConfirmation = deleteDialog.getByLabel(/Type the full book name/u);
  const finalDelete = deleteDialog.getByRole("button", { name: "delete book and notes" });
  await titleConfirmation.fill("Moby");
  await expect(finalDelete, "a partial title cannot delete the shared book").toBeDisabled();
  await titleConfirmation.fill(books.pdf.title);
  await expect(finalDelete, "the exact title unlocks the destructive action").toBeEnabled();
  await finalDelete.click();

  await expect(
    page.getByRole("dialog", { name: "group" }),
    "finishing deletion returns to the reader",
  ).toHaveCount(0);
  await expect(
    page.locator(books.epub.ready),
    "the reader falls forward to the remaining EPUB",
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(books.epub.title, { exact: true })).toBeVisible();

  const deletedSource = await page
    .context()
    .request.get(`/groups/${ref}/book?sourceId=${encodeURIComponent(sourceId)}`);
  expect(deletedSource.status(), "the removed book is no longer downloadable").toBe(404);
});

test("Library · selecting an EPUB inspects, uploads, and opens it", async ({ page }) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);

  await page.getByTitle("switch book").click();
  await page.getByTitle("Add a book").click();
  const uploadDialog = page.getByRole("dialog", { name: "add a book" });
  await uploadDialog.locator('input[type="file"]').setInputFiles(fileURLToPath(books.epub.file));
  await expect(uploadDialog.getByRole("heading", { name: "upload info" })).toBeVisible({
    timeout: 30_000,
  });
  const upload = uploadDialog.getByTitle("Upload book");
  await expect(upload, "a healthy EPUB is accepted for upload").toBeEnabled();
  await upload.click();

  await expect(uploadDialog).toHaveCount(0);
  await expect(
    page.locator(books.epub.ready),
    "the newly uploaded EPUB opens automatically",
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(books.epub.title, { exact: true })).toBeVisible();

  const groupResponse = await page.context().request.get(`/groups/${ref}`);
  // SAFETY: the checked successful response exposes the group's source ids.
  const { group } = (await groupResponse.json()) as { group: { sources: string[] } };
  expect(
    group.sources,
    "both the original PDF and uploaded EPUB remain in the library",
  ).toHaveLength(2);
});

test("Reader · an EPUB starts and advances in linear spine order", async ({ page }) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);

  await page.getByTitle("switch book").click();
  await page.getByTitle("Add a book").click();
  const uploadDialog = page.getByRole("dialog", { name: "add a book" });
  await uploadDialog
    .locator('input[type="file"]')
    .setInputFiles({
      name: "navigation-only-cover.epub",
      mimeType: "application/epub+zip",
      buffer: epubWithNavigationOnlyCover(),
    });
  await expect(uploadDialog.getByRole("heading", { name: "upload info" })).toBeVisible({
    timeout: 30_000,
  });
  await uploadDialog.getByTitle("Upload book").click();

  const book = page.frameLocator(".epub-container iframe");
  await expect(
    book.getByRole("heading", { name: "Linear reading start" }),
    "a navigation-only cover cannot replace the EPUB's reading order",
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTitle("Next page").click();
  await expect(
    book.getByRole("heading", { name: "Chapter one" }),
    "page turns continue through linear spine items",
  ).toBeVisible();
});

test("Reader · a saved non-linear EPUB position falls forward to reading order", async ({
  page,
}) => {
  const { group, ref } = await seedWorkspace(page.context());
  const epub = epubWithNavigationOnlyCover();
  const uploaded = await page
    .context()
    .request.put(`/groups/${ref}/book`, {
      data: epub,
      headers: {
        "Content-Type": "application/epub+zip",
        "X-Source-Title": encodeURIComponent("Navigation-only cover"),
      },
    });
  expect(uploaded.ok(), "the regression EPUB uploads").toBe(true);
  // SAFETY: the checked successful upload response contains its content hash.
  const { hash: sourceId } = (await uploaded.json()) as { hash: string };

  const positioned = await page
    .context()
    .request.put("/me/reading-position", {
      data: {
        groupId: group.groupId,
        sourceId,
        position: {
          kind: "epub",
          groupId: group.groupId,
          sourceId,
          updatedAt: new Date().toISOString(),
          cfi: "epubcfi(/6/2!/4/1:0)",
          percentage: 0,
        },
      },
    });
  expect(positioned.ok(), "the old cover position is stored").toBe(true);

  await page.addInitScript(
    ({ groupId, selectedSourceId }) =>
      localStorage.setItem(`bookclub.selectedSource.${groupId}`, selectedSourceId),
    { groupId: group.groupId, selectedSourceId: sourceId },
  );
  await openWorkspace(page, ref, ".epub-container iframe");
  const book = page.frameLocator(".epub-container iframe");
  await expect(
    book.getByRole("heading", { name: "Linear reading start" }),
    "a saved position cannot restore a reader to a non-linear cover",
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTitle("Next page").click();
  await expect(book.getByRole("heading", { name: "Chapter one" })).toBeVisible();
});

test("Naming · club and book renames survive a reload", async ({ page }) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);

  await page.getByTitle("Double-click to rename the club").dblclick();
  await page.getByLabel("club name").fill("Renamed Reading Club");
  await page.getByLabel("club name").press("Enter");
  await expect(page.getByRole("heading", { name: "Renamed Reading Club" })).toBeVisible();

  await page.getByTitle("Double-click to rename the book").dblclick();
  await page.getByLabel("book title").fill("The Whale");
  await page.getByLabel("book title").press("Enter");
  await expect(page.getByText("The Whale", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator(books.pdf.ready)).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Renamed Reading Club" }),
    "the club rename is stored on the server",
  ).toBeVisible();
  await expect(
    page.getByText("The Whale", { exact: true }),
    "the book rename is stored on the server",
  ).toBeVisible();
});
