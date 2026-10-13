import { expect, test, type Page } from "@playwright/test";
import {
  authenticateContext,
  books,
  openWorkspace,
  seedWorkspace,
  uploadBook,
  watchForUnexpectedBrowserFailures,
  type GroupSummary,
} from "./browserSupport.ts";

const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const search = (page: Page) => page.getByRole("combobox", { name: "Search commands" });

async function runCommand(page: Page, query: string, title: string): Promise<void> {
  await page.keyboard.press("Meta+k");
  await expect(search(page)).toBeFocused();
  await search(page).fill(query);
  await expect(palette(page).getByRole("option").first()).toHaveAccessibleName(title);
  await search(page).press("Enter");
  await expect(palette(page)).toHaveCount(0);
}

async function createClub(page: Page, displayName: string): Promise<string> {
  const created = await page.context().request.post("/groups", { data: { displayName } });
  expect(created.status()).toBe(201);
  // SAFETY: the public creation response supplies the club's URL identity.
  const { group } = (await created.json()) as { group: GroupSummary };
  return `${group.slug}-${group.publicId}`;
}

test("Commands · books from every accessible club are searchable from home and switch clubs", async ({
  page,
  browser,
}) => {
  const { ref } = await seedWorkspace(page.context());
  const otherRef = await createClub(page, "Astronomy Readers");
  await uploadBook(page.context(), otherRef, books.pdf);
  await uploadBook(page.context(), otherRef, books.epub);
  const outsider = await browser.newContext();
  try {
    await seedWorkspace(outsider, books.epub);
  } finally {
    await outsider.close();
  }
  const assertHealthy = watchForUnexpectedBrowserFailures(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bookclub", exact: true })).toBeVisible();
  await page.keyboard.press("Meta+k");
  await search(page).fill("astronomy dorian");
  const target = palette(page).getByRole("option").first();
  await expect(target).toHaveAccessibleName(`Switch to book: ${books.epub.title}`);
  await expect(target).toHaveAccessibleDescription("Books · Astronomy Readers");
  await expect(target, "each book identifies its club").toContainText("Books · Astronomy Readers");
  await search(page).press("Enter");
  await expect(page).toHaveURL(`/clubs/${otherRef}`);
  await expect(page.locator(books.epub.ready)).toBeVisible();
  await expect(page.locator(".reader-title")).toHaveText(books.epub.title);

  await page.keyboard.press("Meta+k");
  await search(page).fill("moby dick");
  const copies = palette(page).getByRole("option");
  await expect(copies, "the same book in two clubs has two distinct destinations").toHaveCount(2);
  await copies.filter({ hasText: "Workspace Regression Club" }).click();
  await expect(page).toHaveURL(`/clubs/${ref}`);
  await expect(page.locator(books.pdf.ready).first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`/clubs/${otherRef}`);
  await expect(page.locator(books.epub.ready)).toBeVisible();
  await page.keyboard.press("Meta+k");
  await search(page).fill("dorian");
  await expect(
    palette(page).getByRole("option"),
    "another user's private club contributes no book commands",
  ).toHaveCount(1);
  await assertHealthy();
});

test("Commands · cached books remain available while the catalog refreshes and after a failed reload", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  const otherRef = await createClub(page, "Astronomy Readers");
  const sourceId = await uploadBook(page.context(), otherRef, books.epub);
  const catalog = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/groups",
  );
  await openWorkspace(page, ref);
  await catalog;
  const renamed = await page
    .context()
    .request.put(`/groups/${otherRef}/book/title`, {
      data: { sourceId, title: "A newly renamed book" },
    });
  expect(renamed.status()).toBe(200);

  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/groups", async (route) => {
    await refreshGate;
    await route.continue();
  });
  try {
    await page.keyboard.press("Meta+k");
    await expect(search(page)).toBeFocused();
    await search(page).fill("astronomy dorian");
    await expect(palette(page).getByRole("option").first()).toHaveAccessibleName(
      `Switch to book: ${books.epub.title}`,
    );
    await expect(palette(page).getByRole("status")).toHaveText("Updating clubs and books…");
  } finally {
    releaseRefresh();
  }
  await search(page).fill("newly renamed astronomy");
  await expect(palette(page).getByRole("option").first()).toHaveAccessibleName(
    "Switch to book: A newly renamed book",
  );
  await page.keyboard.press("Escape");
  await page.unroute("**/groups");
  await page.route("**/groups", (route) => route.abort());
  await page.reload();
  await expect(page.locator(books.pdf.ready).first()).toBeVisible();
  await page.keyboard.press("Meta+k");
  await search(page).fill("newly renamed astronomy");
  await expect(palette(page).getByRole("option").first()).toHaveAccessibleName(
    "Switch to book: A newly renamed book",
  );
  await expect(palette(page).getByRole("status")).toContainText("Showing saved commands");
  await search(page).press("Enter");
  await expect(page).toHaveURL(`/clubs/${otherRef}`);
  await expect(page.locator(books.epub.ready)).toBeVisible();
  await expect(page.locator(".reader-title")).toHaveText("A newly renamed book");
});

test("Commands · keyboard navigation, empty search, dismissal, and focus preserve the workspace", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);
  const assertHealthy = watchForUnexpectedBrowserFailures(page);
  const previousControl = page.getByRole("button", { name: "settings", exact: true });
  await previousControl.focus();
  await previousControl.press("Meta+k");
  await expect(search(page)).toBeFocused();
  const options = palette(page).getByRole("option");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await search(page).press("ArrowUp");
  await expect(options.last(), "up wraps to the last command").toHaveAttribute(
    "aria-selected",
    "true",
  );
  await search(page).press("ArrowDown");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await search(page).press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");

  await search(page).fill("this-command-does-not-exist");
  await expect(palette(page).getByRole("status")).toHaveText("No matching commands");
  await search(page).press("ArrowDown");
  await search(page).press("Enter");
  await expect(palette(page)).toBeVisible();
  await search(page).press("Tab");
  await expect(palette(page).getByRole("button", { name: "close" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search(page)).toBeFocused();
  await search(page).press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(previousControl, "dismissal restores the previous control").toBeFocused();

  await page.keyboard.press("Control+k");
  await expect(search(page)).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toHaveCount(0);
  await page.keyboard.press("Meta+k");
  await expect(search(page)).toHaveValue("");
  await page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(palette(page)).toHaveCount(0);
  const filter = page.getByRole("textbox", { name: "Filter notes" });
  await filter.fill("keep this draft");
  await filter.press("Meta+k");
  await expect(search(page), "the shortcut works from a typing control").toBeFocused();
  await page.keyboard.press("Escape");
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue("keep this draft");
  await expect(page.locator(books.pdf.ready).first()).toBeVisible();
  await assertHealthy();
});

test("Commands · usage ranking survives reload while a search still finds the relevant command", async ({
  page,
}) => {
  await authenticateContext(page.context(), "command-history");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "settings", exact: true })).toBeVisible();
  const assertHealthy = watchForUnexpectedBrowserFailures(page);
  for (let count = 0; count < 2; count += 1) {
    await runCommand(page, "settings", "Settings");
    await expect(page.getByRole("dialog", { name: "account settings", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await runCommand(page, "release log", "About & release log");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("button", { name: "settings", exact: true })).toBeVisible();
  await page.keyboard.press("Meta+k");
  await expect(palette(page).getByRole("option").first()).toHaveAccessibleName("Settings");
  await search(page).fill("release log");
  await expect(palette(page).getByRole("option").first()).toHaveAccessibleName(
    "About & release log",
  );
  await search(page).press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await assertHealthy();
});

test("Commands · discover clubs and books and execute the same reader, settings, upload, and invite actions", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  await uploadBook(page.context(), ref, books.epub);
  const created = await page
    .context()
    .request.post("/groups", { data: { displayName: "Café Astronomy Circle" } });
  expect(created.status()).toBe(201);
  // SAFETY: the public creation response supplies the club's URL identity.
  const { group } = (await created.json()) as { group: { slug: string; publicId: string } };
  await openWorkspace(page, ref);
  const assertHealthy = watchForUnexpectedBrowserFailures(page);

  await page.getByTitle("Next page", { exact: true }).click();
  await runCommand(page, "double page", "Double page layout");
  await expect(page.locator(".pdf-pane"), "double-page layout renders a spread").toHaveCount(2);
  await runCommand(page, "hide notes", "Hide notes");
  await expect(page.locator(".split-pane--notes")).toHaveAttribute("aria-hidden", "true");
  await runCommand(page, "show notes", "Show notes");
  await expect(page.locator(".split-pane--notes")).toHaveAttribute("aria-hidden", "false");
  await runCommand(page, "hide reader", "Hide reader");
  await expect(page.locator(".split-pane--reader")).toHaveAttribute("aria-hidden", "true");
  await runCommand(page, "show reader", "Show reader");
  await expect(page.locator(".split-pane--reader")).toHaveAttribute("aria-hidden", "false");
  await runCommand(page, "dorian", `Switch to book: ${books.epub.title}`);
  await expect(page.locator(books.epub.ready)).toBeVisible();
  await runCommand(page, "moby dick", `Switch to book: ${books.pdf.title}`);
  await expect(page.locator(books.pdf.ready).first()).toBeVisible();

  await runCommand(page, "group settings", "Group settings");
  await expect(page.getByRole("dialog", { name: "settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "General", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "General", exact: true }),
    "Escape restores the previous settings page",
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await runCommand(page, "upload book", "Upload book");
  await expect(page.getByRole("dialog", { name: "add a book" })).toBeVisible();
  await page.keyboard.press("Escape");
  await runCommand(page, "invite", "Invite people");
  await expect(page.getByRole("dialog", { name: /invite/iu })).toBeVisible();
  await page.keyboard.press("Escape");

  await runCommand(page, "cafe astronomy", "Switch to club: Café Astronomy Circle");
  await expect(page).toHaveURL(`/clubs/${group.slug}-${group.publicId}`);
  await expect(
    page.getByRole("heading", { name: "Café Astronomy Circle", exact: true }),
  ).toBeVisible();
  await runCommand(page, "workspace regression", "Switch to club: Workspace Regression Club");
  await expect(page).toHaveURL(`/clubs/${ref}`);
  await expect(page.locator(books.pdf.ready).first()).toBeVisible();
  await runCommand(page, "home", "Go to home");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Bookclub", exact: true })).toBeVisible();
  await assertHealthy();
});

test("Commands · the palette follows the theme while reading an EPUB", async ({ page }) => {
  const { ref } = await seedWorkspace(page.context(), books.epub);
  await openWorkspace(page, ref, books.epub.ready);
  const assertHealthy = watchForUnexpectedBrowserFailures(page);
  await runCommand(page, "dark theme", "Use Dark theme");
  const body = page.locator(books.epub.ready).first().contentFrame().locator("body");
  await expect(body).toHaveCSS("background-color", "rgb(36, 36, 36)");
  await page.keyboard.press("Meta+k");
  await expect(search(page)).toBeFocused();
  await expect(palette(page)).toHaveCSS("background-color", "rgb(36, 36, 36)");
  await expect(palette(page)).toHaveCSS("color", "rgb(242, 242, 242)");
  await search(page).fill("fit to text");
  await expect(
    palette(page).getByRole("option"),
    "PDF fitting is unavailable for an EPUB",
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await runCommand(page, "text size", "Increase text size");
  await expect(page.locator(".font-size")).toContainText("18 pt");
  await assertHealthy();
});

test("Commands · signed-out visitors discover global actions without member-only upload or invite", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  await page.context().clearCookies();
  await page.goto(`/clubs/${ref}`);
  await expect(page.getByRole("dialog", { name: "sign in", exact: true })).toBeVisible();
  await page.keyboard.press("Meta+k");
  await search(page).fill("upload book");
  await expect(palette(page).getByRole("option")).toHaveCount(0);
  await search(page).fill("invite");
  await expect(palette(page).getByRole("option")).toHaveCount(0);
  await search(page).fill("settings");
  await expect(palette(page).getByRole("option").first()).toHaveAccessibleName("Settings");
});

// WebKit blocks parent-installed keyboard listeners inside script-disabled frames
// (https://bugs.webkit.org/show_bug.cgi?id=218086). Keep books script-disabled.
test("Commands · Command+K opens from focused EPUB content @chromium", async ({ page }) => {
  const { ref } = await seedWorkspace(page.context(), books.epub);
  await openWorkspace(page, ref, books.epub.ready);
  const body = page.locator(books.epub.ready).first().contentFrame().locator("body");
  await body.click();
  await body.press("Meta+k");
  await expect(search(page)).toBeFocused();
  await search(page).fill("reader settings");
  await search(page).press("Enter");
  await expect(page.getByRole("dialog", { name: "settings", exact: true })).toBeVisible();
});
