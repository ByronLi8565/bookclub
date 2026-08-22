import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const legacyWorker = `
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("bookclub-release-a").then((cache) => cache.add("/old-asset.js")));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(caches.match("/index.html").then((cached) => cached || fetch(event.request)));
  }
});
`;

// This is the production migration worker emitted by vite-plugin-pwa's
// `selfDestroying` mode. It remains at /sw.js so an old registration can update
// to it even though the new HTML no longer registers a worker.
const retiringWorker = `
self.addEventListener("install", () => self.skipWaiting());
 self.addEventListener("activate", () => {
  self.registration.unregister()
    .then(() => self.clients.matchAll())
    .then((clients) => {
      for (const client of clients) {
        if (client instanceof WindowClient) client.navigate(client.url);
      }
    })
    .then(() => caches.keys())
    .then((names) => Promise.all(names.map((name) => caches.delete(name))));
});
`;

type Release = "a" | "b";

function html(release: Release): string {
  const legacyRegistration =
    release === "a"
      ? `<script>navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready)</script>`
      : "";
  return `<!doctype html><html><body data-release="${release}">${legacyRegistration}</body></html>`;
}

test("Deployment · a new release retires cached application shells before loading", async ({
  page,
}) => {
  let release: Release = "a";
  const server: Server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/sw.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(release === "a" ? legacyWorker : retiringWorker);
      return;
    }
    if (request.url === "/old-asset.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end("// release a");
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(html(release));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No test server port");
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect
      .poll(() =>
        page.evaluate(async () => ({
          controlled: navigator.serviceWorker.controller !== null,
          caches: await caches.keys(),
        })),
      )
      .toEqual({ controlled: true, caches: ["bookclub-release-a"] });

    // A deploy swaps the origin in place while a release-A page and worker are
    // still alive. Updating that existing registration must move the tab to B,
    // unregister the worker, and remove A's application-shell cache.
    release = "b";
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error("The legacy worker was not installed");
      await registration.update();
    });

    await expect(page.locator("body")).toHaveAttribute("data-release", "b");
    await expect
      .poll(() =>
        page.evaluate(async () => ({
          registrations: (await navigator.serviceWorker.getRegistrations()).length,
          caches: await caches.keys(),
        })),
      )
      .toEqual({ registrations: 0, caches: [] });

    await page.reload();
    await expect(page.locator("body")).toHaveAttribute("data-release", "b");
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  } finally {
    server.close();
    await once(server, "close");
  }
});
