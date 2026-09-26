import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  authenticateContext,
  books,
  seedWorkspace,
  uploadBook,
  type BrowserIdentity,
} from "./browserSupport.ts";

// A measurement loop, not a pass/fail gate: it reports how long a reader waits
// for the moments that matter against the production bundle. Only the
// Performance project runs it (READER_PERF=1, `bun run perf:reader`).

type Book = (typeof books)[keyof typeof books];

interface SampleSummary {
  readonly samplesMs: readonly number[];
  readonly medianMs: number;
  readonly p95Ms: number;
}

const iterations = Math.max(1, Number(process.env.READER_PERF_ITERATIONS ?? 3));

function percentile(samples: readonly number[], fraction: number): number {
  const ordered = samples.toSorted((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
}

function summarize(samples: readonly number[]): SampleSummary {
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    samplesMs: samples.map(round),
    medianMs: round(percentile(samples, 0.5)),
    p95Ms: round(percentile(samples, 0.95)),
  };
}

async function measure(run: () => Promise<void>): Promise<number> {
  const startedAt = performance.now();
  await run();
  return performance.now() - startedAt;
}

async function waitForReader(page: Page, book: Book): Promise<void> {
  await expect(page.locator(book.ready).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".loading--reader")).toHaveCount(0, { timeout: 30_000 });
}

/** An EPUB can be read before it is paginated; the page count arrives when it is. */
async function waitForPagination(page: Page): Promise<void> {
  await expect(page.locator(".page-count")).toHaveText(/\d+\s*\/\s*[1-9]\d*/u, { timeout: 60_000 });
}

async function switchTo(page: Page, book: Book): Promise<void> {
  await page.getByTitle("Switch book").click();
  await page.getByTitle(new RegExp(`Open ${book.title}`, "u")).click();
  await waitForReader(page, book);
}

async function turnPage(page: Page): Promise<void> {
  const before = (await page.locator(".page-count").textContent()) ?? "";
  await page.getByTitle("Next page").click();
  await expect(page.locator(".page-count")).not.toHaveText(before, { timeout: 30_000 });
}

async function coldOpens(
  browser: Browser,
  owner: BrowserIdentity,
  ref: string,
  book: Book,
): Promise<{ opens: number[]; pagination: number[] }> {
  const opens: number[] = [];
  const pagination: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const context = await browser.newContext();
    try {
      await authenticateContext(context, "perf", owner.email);
      const page = await context.newPage();
      // The club reopens its most recent book; select this one first so the
      // cold open measures it.
      await page.goto(`/clubs/${ref}`);
      await expect(page.getByTitle("Switch book")).toBeVisible({ timeout: 30_000 });
      await switchTo(page, book);
      await page.close();
      const fresh = await context.newPage();
      opens.push(
        await measure(async () => {
          await fresh.goto(`/clubs/${ref}`);
          await waitForReader(fresh, book);
        }),
      );
      if (book === books.epub) pagination.push(await measure(() => waitForPagination(fresh)));
    } finally {
      await context.close();
    }
  }
  return { opens, pagination };
}

test("Reader performance · cold opens, refreshes, page turns, and book switches @perf", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const { ref, owner } = await seedWorkspace(page.context(), books.pdf);
  await uploadBook(page.context(), ref, books.epub);

  const pdfCold = await coldOpens(browser, owner, ref, books.pdf);
  const epubCold = await coldOpens(browser, owner, ref, books.epub);

  await page.goto(`/clubs/${ref}`);
  await expect(page.getByTitle("Switch book")).toBeVisible({ timeout: 30_000 });
  await switchTo(page, books.pdf);

  const pdfRefresh: number[] = [];
  for (let index = 0; index < iterations; index++) {
    pdfRefresh.push(await measure(() => page.reload().then(() => waitForReader(page, books.pdf))));
  }

  const pdfToEpub: number[] = [];
  const epubPaginationReady: number[] = [];
  const epubToPdf: number[] = [];
  for (let index = 0; index < iterations; index++) {
    pdfToEpub.push(await measure(() => switchTo(page, books.epub)));
    epubPaginationReady.push(await measure(() => waitForPagination(page)));
    epubToPdf.push(await measure(() => switchTo(page, books.pdf)));
  }

  const pdfTurns: number[] = [];
  for (let index = 0; index < iterations; index++)
    pdfTurns.push(await measure(() => turnPage(page)));

  await switchTo(page, books.epub);
  await waitForPagination(page);
  const epubTurns: number[] = [];
  for (let index = 0; index < iterations; index++) {
    epubTurns.push(await measure(() => turnPage(page)));
  }

  const epubRefresh: number[] = [];
  for (let index = 0; index < iterations; index++) {
    epubRefresh.push(
      await measure(async () => {
        await page.reload();
        await waitForReader(page, books.epub);
        await waitForPagination(page);
      }),
    );
  }

  const report = {
    iterations,
    pdfColdOpen: summarize(pdfCold.opens),
    epubColdOpen: summarize(epubCold.opens),
    epubColdPagination: summarize(epubCold.pagination),
    pdfRefresh: summarize(pdfRefresh),
    epubRefresh: summarize(epubRefresh),
    pdfToEpub: summarize(pdfToEpub),
    epubPaginationReady: summarize(epubPaginationReady),
    epubToPdf: summarize(epubToPdf),
    pdfPageTurn: summarize(pdfTurns),
    epubPageTurn: summarize(epubTurns),
  };
  console.log(`READER_PERF ${JSON.stringify(report)}`);
  await testInfo.attach("reader-performance.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
});
