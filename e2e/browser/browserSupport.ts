import { readFile } from "node:fs/promises";
import { expect, type BrowserContext, type FrameLocator, type Page } from "@playwright/test";
import { ulid } from "ulidx";
import { UPLOAD_FILE_FIELD } from "../../src/shared/http/uploads.ts";
import { targetBaseUrl } from "../src/ports.ts";

const BASE_URL = targetBaseUrl("browser");
export const books = {
  pdf: {
    file: new URL("../../assets/moby-dick.pdf", import.meta.url),
    contentType: "application/pdf",
    title: "Moby Dick",
    ready: ".pdf-page canvas",
  },
  epub: {
    file: new URL("../../assets/dorian.epub", import.meta.url),
    contentType: "application/epub+zip",
    title: "The Picture of Dorian Gray",
    ready: ".reader-surface .epub-container iframe",
  },
} as const;

export interface BrowserIdentity {
  id: string;
  email: string;
  name: string;
}

export interface GroupSummary {
  groupId: string;
  slug: string;
  publicId: string;
}

export async function authenticateContext(
  context: BrowserContext,
  label = "workspace",
  email = `${label}-${ulid().toLowerCase()}@example.com`,
): Promise<BrowserIdentity> {
  const auth = await context.request.post("/auth/start", { data: { email } });
  expect(auth.ok(), "dev auth creates a real browser session").toBe(true);
  // SAFETY: the checked successful auth response uses the test harness identity envelope.
  const { token, user } = (await auth.json()) as { token: string; user: BrowserIdentity };
  // Local WebKit will not retain the production Secure cookie over HTTP, so
  // install the public dev-auth token in the browser jar used by the SPA.
  await context.addCookies([
    { name: "bc_session", value: token, url: BASE_URL, httpOnly: true, sameSite: "Lax" },
  ]);
  return user;
}

export async function seedWorkspace(
  context: BrowserContext,
  book: (typeof books)[keyof typeof books] = books.pdf,
): Promise<{ group: GroupSummary; ref: string; owner: BrowserIdentity; sourceId: string }> {
  const owner = await authenticateContext(context, "owner");
  const created = await context.request.post("/groups", {
    data: { displayName: "Workspace Regression Club" },
  });
  expect(created.status(), "the signed-in user can create a club").toBe(201);
  // SAFETY: the checked successful group creation response uses the shared group envelope.
  const { group } = (await created.json()) as { group: GroupSummary };
  const ref = `${group.slug}-${group.publicId}`;

  const sourceId = await uploadBook(context, ref, book);
  return { group, ref, owner, sourceId };
}

/** Uploads are multipart, so the media type rides on the part rather than on the request. */
export function uploadPart(buffer: Buffer, mimeType: string, name: string) {
  return { [UPLOAD_FILE_FIELD]: { name, mimeType, buffer } };
}

export async function uploadBook(
  context: BrowserContext,
  ref: string,
  book: (typeof books)[keyof typeof books],
): Promise<string> {
  const uploaded = await context.request.put(`/groups/${ref}/book`, {
    multipart: uploadPart(await readFile(book.file), book.contentType, book.title),
    headers: { "X-Source-Title": encodeURIComponent(book.title) },
  });
  expect(uploaded.ok(), "the club has a real book to lay out").toBe(true);
  // SAFETY: the checked successful upload response contains its content hash.
  const { hash } = (await uploaded.json()) as { hash: string };
  return hash;
}

export async function joinGroup(
  ownerContext: BrowserContext,
  memberContext: BrowserContext,
  ref: string,
): Promise<void> {
  const invite = await ownerContext.request.post(`/groups/${ref}/invite-link`);
  expect(invite.ok(), "the owner can create an invite for browser setup").toBe(true);
  // SAFETY: the checked successful invite response contains the invite token.
  const { token } = (await invite.json()) as { token: string };
  const joined = await memberContext.request.post(`/groups/${ref}/join`, { data: { token } });
  expect(joined.ok(), "the second browser joins the club through its invite").toBe(true);
}

export async function openWorkspace(
  page: Page,
  ref: string,
  ready: string = books.pdf.ready,
): Promise<void> {
  await page.goto(`/clubs/${ref}`);
  await expect(page.locator(ready)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".split-divider, .pager-tabs").first()).toBeVisible();
}

export async function selectPdfText(page: Page): Promise<void> {
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

/** The visible book's content document. Pagination measurement keeps a second,
 * offscreen rendition under <body>; only the one inside the reader surface is read. */
export async function epubFrame(page: Page): Promise<FrameLocator> {
  const visibleFrame = page.locator(books.epub.ready).first();
  await expect(visibleFrame).toBeVisible({ timeout: 30_000 });
  const frame = visibleFrame.contentFrame();
  await frame.locator("body").waitFor();
  return frame;
}

/** `passage` picks a different run of text: re-selecting the range the book
 * already holds changes nothing, so the reader rightly sees no new selection. */
export async function selectEpubText(page: Page, passage = 0): Promise<void> {
  const frame = await epubFrame(page);
  await frame.locator("body").evaluate((body, skip) => {
    const wanted = 80;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    for (let skipped = -1; node; node = walker.nextNode()) {
      if ((node.textContent?.trim().length ?? 0) >= 8 && ++skipped === skip) break;
    }
    if (!node?.textContent) throw new Error("No selectable EPUB text");
    const start = node.textContent.search(/\S/u);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, Math.min(node.textContent.length, start + wanted));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, passage);
}

/** Highlights paint into the page for a PDF and inside the content document for an EPUB. */
export async function paintedHighlights(page: Page): Promise<number> {
  const inPage = await page.locator(".bc-highlight").count();
  if (inPage > 0 || (await page.locator(books.epub.ready).count()) === 0) return inPage;
  return (await epubFrame(page)).locator(".bc-highlight").count();
}

export function currentPage(page: Page): Promise<number | null> {
  return page.locator(".page-count").evaluate((element) => {
    const match = element.textContent?.match(/(\d+)\s*\/\s*(\d+)/u);
    return match ? Number(match[1]) : null;
  });
}

/** Common journeys should fail on browser/runtime faults even when the final
 * element happens to render. Assertions at the end keep intentional setup
 * requests readable while making silent console and transport failures fatal. */
export function watchForUnexpectedBrowserFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // epub.js copies a book's inline scripts into a deliberately scriptless
    // sandbox. WebKit reports each refused script as a console error even
    // though blocking it is the reader's security contract.
    if (
      message.text().includes("Blocked script execution") &&
      message.text().includes("allow-scripts")
    ) {
      return;
    }
    failures.push(`console error: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "unknown failure";
    if (!reason.includes("ERR_ABORTED")) {
      failures.push(`request failed: ${request.method()} ${request.url()} (${reason})`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failures.push(
        `server error: ${response.status()} ${response.request().method()} ${response.url()}`,
      );
    }
  });
  return async () => {
    await expect(page.locator(".toast--error"), "the journey raises no error toast").toHaveCount(0);
    expect(failures, "the journey raises no browser, console, transport, or server error").toEqual(
      [],
    );
  };
}
