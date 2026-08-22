import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";

// The whole Foldkit entry against the real worker, which is the seam no slice
// test and no harness crosses: session decoding, group references, and the
// download that fills the source cache all live between the two, and all three
// were broken while every other gate passed.
//
// One journey rather than several tests: the checks are sequential stages of a
// single session, and a detached macOS launchd session gives Chromium only one
// usable browser context (see PW_DETACHED_SESSION in playwright.config.ts).
const PASSWORD = "devdevdev";
const REF_PATTERN = "[a-z0-9-]+";
const DISPLAY_NAME = "Parity Club";

/** Seeds an account and a club with a book through the API, so the journey
 *  starts from a known state rather than whatever the dev worker holds. */
async function seedClub(request: APIRequestContext): Promise<string> {
  const email = `foldkit-${Date.now()}@bookclub.test`;
  const started = await request.post("/auth/start", { data: { email } });
  expect(started.ok(), "dev sign-in needs DEV_AUTH=true").toBeTruthy();

  const passworded = await request.put("/me/password", { data: { password: PASSWORD } });
  expect(passworded.ok()).toBeTruthy();

  const created = await request.post("/groups", { data: { displayName: DISPLAY_NAME } });
  expect(created.ok()).toBeTruthy();
  // SAFETY: the create-group endpoint answers 201 with this shape, asserted ok above.
  const { group } = (await created.json()) as { group: { slug: string; publicId: string } };

  const uploaded = await request.put(`/groups/${group.slug}-${group.publicId}/book`, {
    headers: { "x-source-title": "The Picture of Dorian Gray" },
    multipart: {
      file: {
        name: "dorian.epub",
        mimeType: "application/epub+zip",
        buffer: readFileSync(new URL("../../../assets/dorian.epub", import.meta.url)),
      },
    },
  });
  expect(uploaded.ok()).toBeTruthy();

  return email;
}

test("a reader signs in, picks a club, and opens its book", async ({ page, request }) => {
  const email = await seedClub(request);
  // Seeding runs through the page's own cookie jar, so the journey has to start
  // by putting the reader back outside the door it just walked through.
  await page.context().clearCookies();

  await page.goto("/");

  // `home.css` applies through these class names and nothing else, so a page
  // that renders the right elements with the wrong ones is bare markup.
  const card = page.locator(".home-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS("border-top-width", "3px");
  expect(await card.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");

  const cardBefore = await card.boundingBox();
  await page.getByRole("button", { name: "sign in" }).first().click();

  // A `<dialog>` without `open` is hidden outright by the UA stylesheet, so the
  // route changes and the reader sees nothing happen.
  const dialog = page.locator("dialog.modal");
  await expect(dialog).toBeVisible();

  // The modal lays over the card. If it wraps the card instead, `.home` stops
  // being a direct child of `.app`, loses its height, and the page jumps.
  expect(await card.boundingBox()).toEqual(cardBefore);

  // Every way in the React modal offers: a mailed code by default, a password,
  // or a passkey.
  await expect(dialog.getByRole("button", { name: "send code" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "use a passkey" })).toBeVisible();

  // The dev worker signs a known email in outright rather than mailing a code,
  // which is the only way in for an account with no password set.
  await dialog.getByLabel("Email address").fill(email);
  await dialog.getByRole("button", { name: "send code" }).click();
  await expect(page.locator(".login-email")).toHaveText(email);

  await page.getByRole("button", { name: "sign out" }).click();
  await expect(page.locator(".login-signin")).toBeVisible();

  await page.getByRole("button", { name: "sign in" }).first().click();
  await dialog.getByLabel("Email address").fill(email);
  await dialog.getByLabel("Password").fill(PASSWORD);
  // Each field has to survive the other: a form reporting both as one message
  // writes a stale value back over whichever was edited first.
  await expect(dialog.getByLabel("Email address")).toHaveValue(email);
  await expect(dialog.getByLabel("Password")).toHaveValue(PASSWORD);

  const submit = dialog.getByRole("button", { name: "sign in" });
  // Enabled only once both fields reached the Model, which is the real signal
  // that the form is wired rather than merely rendered.
  await expect(submit).toBeEnabled();
  await submit.click();

  // The session response carries a `set-cookie` the browser hides from `fetch`;
  // a client that requires it to decode never gets past here. Landing anywhere
  // but the clubs card means signing in did not move the route.
  await expect(page.locator(".login-email")).toHaveText(email);
  await expect(dialog).toHaveCount(0);

  // A club is reached by its URL now, so the entry is a link and the click has
  // to leave the address bar pointing at the club.
  await page.locator(".home-club-list").getByRole("link", { name: DISPLAY_NAME }).click();
  await expect(page).toHaveURL(new RegExp(`/clubs/${REF_PATTERN}$`, "u"));

  // A club reference is `slug-publicId`; a bare publicId answers 404 and the
  // club never resolves. A club with a book *is* the workspace — there is no
  // catalog page in between — and nothing has cached this book, so opening it
  // has to download it first.
  await expect(page.locator(".app > .topbar")).toBeVisible();
  await expect(page.locator(".topbar h1")).toHaveText(DISPLAY_NAME);
  await expect(page.locator(".epub-container iframe").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".page-count")).toContainText("/", { timeout: 30_000 });
  // The reader and the notes pane sit side by side rather than stacked.
  await expect(page.locator(".split-pane")).toHaveCount(2);
  await expect(page.locator(".split-divider")).toBeVisible();
  await page.keyboard.press("d");
  await expect(page.locator(".split-pane--reader-spread")).toBeVisible();
  const epubBody = page
    .locator(".reader-surface .epub-container iframe")
    .first()
    .contentFrame()
    .locator("body");
  await expect
    .poll(() =>
      epubBody.evaluate((body) => {
        const rawColumnWidth = getComputedStyle(body).columnWidth;
        const columnWidth = Number(
          rawColumnWidth.endsWith("px") ? rawColumnWidth.slice(0, -2) : rawColumnWidth,
        );
        return (
          Number.isFinite(columnWidth) && columnWidth < document.documentElement.clientWidth * 0.75
        );
      }),
    )
    .toBe(true);
  const initialPaneWidths = await page
    .locator(".split-pane")
    .evaluateAll((panes) => panes.map((pane) => pane.getBoundingClientRect().width));
  expect(initialPaneWidths[0]).toBeGreaterThanOrEqual(884);
  expect(initialPaneWidths[1]).toBeGreaterThanOrEqual(280);
  await page.keyboard.press("d");
  await page.waitForTimeout(300);
  await expect(page.locator(".split-pane--reader-spread")).toBeVisible();
  const singlePaneWidths = await page
    .locator(".split-pane")
    .evaluateAll((panes) => panes.map((pane) => pane.getBoundingClientRect().width));
  expect(singlePaneWidths[0]).toBeGreaterThanOrEqual(884);
  expect(singlePaneWidths[1]).toBeGreaterThanOrEqual(280);

  // A drag stops with both panes usable; releasing near an edge must never turn
  // resizing into an accidental pane close.
  const divider = page.locator(".split-divider");
  const box = await divider.boundingBox();
  if (box === null) throw new Error("the split divider has no box to drag");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(40, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".workspace-layout")).not.toHaveClass(/split--expanded/u);
  const paneWidths = await page
    .locator(".split-pane")
    .evaluateAll((panes) => panes.map((pane) => pane.getBoundingClientRect().width));
  expect(Math.min(...paneWidths)).toBeGreaterThan(200);

  // Every overlay the workspace header opens, over the book.
  await page.getByRole("button", { name: "open info" }).click();
  await expect(page.locator("dialog.modal.home-info-panel[open]")).toBeVisible();
  await page.getByRole("button", { name: "close" }).click();
  await expect(page.locator("dialog.modal")).toHaveCount(0);

  const accountSecurity = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/me/passkeys",
  );
  await page.getByRole("button", { name: "settings" }).click();
  await expect(page.locator("dialog.modal[open]")).toBeVisible();
  expect((await accountSecurity).status()).toBe(200);
  await expect(page.locator(".toast--error")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.modal")).toHaveCount(0);

  await page.getByRole("button", { name: /people online/u }).click();
  await expect(page.locator("dialog.modal[open]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.modal")).toHaveCount(0);

  // A club URL is a place, not a screen the app happened to be showing: a reload
  // has to land back on the book, and the way out has to be the browser's own
  // back button. Neither worked while the route lived only in the Model.
  const clubUrl = page.url();
  await page.reload();
  await expect(page.locator(".app > .topbar")).toBeVisible();
  await expect(page.locator(".topbar h1")).toHaveText(DISPLAY_NAME);
  await expect(page.locator(".epub-container iframe").first()).toBeVisible({ timeout: 30_000 });

  await page.goBack();
  await expect(page.locator(".home-card")).toBeVisible();
  // A reload is where the session cookie has to carry the reader: the app has to
  // ask who is signed in, or a returning reader is shown the signed-out page
  // with a perfectly good cookie in hand.
  await expect(page.locator(".login-email")).toHaveText(email);
  await page.goForward();
  await expect(page).toHaveURL(clubUrl);
  await expect(page.locator(".topbar h1")).toHaveText(DISPLAY_NAME);
});
