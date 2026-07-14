import { readFile } from "node:fs/promises";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { ulid } from "ulidx";

export const BASE_URL = "http://localhost:5173";
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
    ready: ".epub-container iframe",
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
  const { group } = (await created.json()) as { group: GroupSummary };
  const ref = `${group.slug}-${group.publicId}`;

  const sourceId = await uploadBook(context, ref, book);
  return { group, ref, owner, sourceId };
}

export async function uploadBook(
  context: BrowserContext,
  ref: string,
  book: (typeof books)[keyof typeof books],
): Promise<string> {
  const uploaded = await context.request.put(`/groups/${ref}/book`, {
    data: await readFile(book.file),
    headers: { "Content-Type": book.contentType, "X-Source-Title": encodeURIComponent(book.title) },
  });
  expect(uploaded.ok(), "the club has a real book to lay out").toBe(true);
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
  const { token } = (await invite.json()) as { token: string };
  const joined = await memberContext.request.post(`/groups/${ref}/join`, { data: { token } });
  expect(joined.ok(), "the second browser joins the club through its invite").toBe(true);
}

export async function openWorkspace(
  page: Page,
  ref: string,
  ready = books.pdf.ready,
): Promise<void> {
  await page.goto(`/clubs/${ref}`);
  await expect(page.locator(ready)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".split-divider")).toBeVisible();
}

export function currentPage(page: Page): Promise<number | null> {
  return page.locator(".page-count").evaluate((element) => {
    const match = element.textContent?.match(/(\d+)\s*\/\s*(\d+)/u);
    return match ? Number(match[1]) : null;
  });
}
