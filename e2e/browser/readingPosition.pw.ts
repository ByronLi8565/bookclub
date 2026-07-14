import { expect, test } from "@playwright/test";
import {
  authenticateContext,
  BASE_URL,
  books,
  currentPage,
  openWorkspace,
  seedWorkspace,
} from "./browserSupport.ts";

test("Reading position · a manual sync opens the same page in another browser", async ({
  browser,
  page,
}) => {
  const { ref, owner } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);

  const startingPage = await currentPage(page);
  await page.getByTitle("Next page").click();
  await expect.poll(() => currentPage(page)).not.toBe(startingPage);
  const syncedPage = await currentPage(page);

  const synced = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/me/reading-position" &&
      response.ok(),
  );
  await page.keyboard.press("Meta+s");
  const syncResponse = await synced;
  const stored = (await syncResponse.json()) as { position: { page: number } };
  expect(stored.position.page, "the server stores the page chosen in the first browser").toBe(
    syncedPage,
  );

  const secondContext = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
  });
  try {
    await authenticateContext(secondContext, "same-member", owner.email);
    const secondPage = await secondContext.newPage();
    let releasePositionRequest = () => {};
    const positionRequestBlocked = new Promise<void>((resolve) => {
      releasePositionRequest = resolve;
    });
    let markPositionRequested = () => {};
    const positionRequested = new Promise<void>((resolve) => {
      markPositionRequested = resolve;
    });
    await secondPage.route(/\/me\/reading-position\?/u, async (route) => {
      markPositionRequested();
      await positionRequestBlocked;
      await route.continue();
    });
    await secondPage.goto(`/clubs/${ref}`);
    await positionRequested;
    await expect(
      secondPage.locator(books.pdf.ready),
      "sync mode does not open the book before the server position arrives",
    ).toHaveCount(0);
    await expect(secondPage.locator(".loading--reader")).toBeVisible();
    releasePositionRequest();
    await expect(secondPage.locator(books.pdf.ready)).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => currentPage(secondPage), {
        message: "the second browser restores the explicitly synced page",
        timeout: 30_000,
      })
      .toBe(syncedPage);
  } finally {
    await secondContext.close();
  }
});

test("Reading position · Local policy opens immediately without waiting for the server", async ({
  page,
}) => {
  const { ref } = await seedWorkspace(page.context());
  await openWorkspace(page, ref);
  await page.getByTitle("Next page").click();
  await expect.poll(() => currentPage(page)).toBeGreaterThan(1);
  const localPage = await currentPage(page);

  await page.getByTitle("Settings").click();
  const settings = page.getByRole("dialog", { name: "settings" });
  await settings.getByTitle("General settings").click();
  await settings.getByLabel("Opening reading position").click();
  await settings.getByTitle("Local").click();
  await settings.getByLabel("close").click();

  let releasePositionRequest = () => {};
  const positionRequestBlocked = new Promise<void>((resolve) => {
    releasePositionRequest = resolve;
  });
  let markPositionRequested = () => {};
  const positionRequested = new Promise<void>((resolve) => {
    markPositionRequested = resolve;
  });
  await page.route(/\/me\/reading-position\?/u, async (route) => {
    markPositionRequested();
    await positionRequestBlocked;
    await route.continue();
  });

  await page.reload();
  await positionRequested;
  await expect(
    page.locator(books.pdf.ready),
    "Local policy mounts the reader while the sync lookup is still blocked",
  ).toBeVisible({ timeout: 30_000 });
  expect(await currentPage(page), "Local policy restores this browser's own page").toBe(localPage);
  releasePositionRequest();
});
