import { expect, test, type Browser, type Page } from "@playwright/test";

type ReaderKind = "pdf" | "epub";

interface SampleSummary {
  readonly samplesMs: readonly number[];
  readonly medianMs: number;
  readonly p95Ms: number;
}

const iterations = Math.max(1, Number(process.env.READER_PERF_ITERATIONS ?? 3));
const pdfPath = process.env.READER_PERF_PDF ?? "/fixtures/moby-dick.pdf";
const epubPath = process.env.READER_PERF_EPUB ?? "/fixtures/dorian.epub";

const switchingUrl = (kind: ReaderKind): string => {
  const params = new URLSearchParams({
    kind,
    switching: "true",
    pdfBook: pdfPath,
    epubBook: epubPath,
  });
  return `/src/tests/harness/foldkitReader.html?${params}`;
};

function percentile(samples: readonly number[], fraction: number): number {
  const ordered = samples.toSorted((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
}

function summarize(samples: readonly number[]): SampleSummary {
  return {
    samplesMs: samples.map((sample) => Math.round(sample * 10) / 10),
    medianMs: Math.round(percentile(samples, 0.5) * 10) / 10,
    p95Ms: Math.round(percentile(samples, 0.95) * 10) / 10,
  };
}

async function waitForReader(page: Page, kind: ReaderKind): Promise<void> {
  if (kind === "pdf") {
    await expect(page.locator(".pdf-page canvas").first()).toBeVisible({ timeout: 30_000 });
  } else {
    const frame = page.locator(".epub-container iframe").first();
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await frame.contentFrame().locator("body").waitFor({ timeout: 30_000 });
  }
  await expect(page.locator(".loading--reader")).toHaveCount(0, { timeout: 30_000 });
}

async function measure(run: () => Promise<void>): Promise<number> {
  const startedAt = performance.now();
  await run();
  return performance.now() - startedAt;
}

async function waitForPageCount(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const match = (await page.locator(".page-count").textContent())?.match(
          /(\d+)\s*\/\s*(\d+)/u,
        );
        return match === null || match === undefined || Number(match[2]) <= 0
          ? null
          : Number(match[2]);
      },
      { timeout: 60_000, intervals: [20] },
    )
    .not.toBeNull();
}

async function switchBook(page: Page, kind: ReaderKind): Promise<void> {
  await page.getByTitle("Switch book").click();
  await page.getByTitle(kind === "pdf" ? "Open Performance PDF" : "Open Performance EPUB").click();
  await waitForReader(page, kind);
}

async function coldOpenSamples(
  browser: Browser,
  kind: ReaderKind,
): Promise<{ opens: number[]; pagination: number[] }> {
  const opens: number[] = [];
  const pagination: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    opens.push(
      await measure(async () => {
        const book = kind === "pdf" ? pdfPath : epubPath;
        await page.goto(
          `/src/tests/harness/foldkitReader.html?kind=${kind}&book=${encodeURIComponent(book)}`,
        );
        await waitForReader(page, kind);
      }),
    );
    if (kind === "epub") pagination.push(await measure(() => waitForPageCount(page)));
    await context.close();
  }
  return { opens, pagination };
}

test.describe("Foldkit reader performance loop", () => {
  test.skip(process.env.READER_PERF !== "1", "run explicitly with bun run perf:reader");

  test("measures cold opens, refreshes, page turns, and source switches", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const pdfCold = await coldOpenSamples(browser, "pdf");
    const epubCold = await coldOpenSamples(browser, "epub");
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(switchingUrl("pdf"));
    await waitForReader(page, "pdf");

    const pdfRefresh: number[] = [];
    for (let index = 0; index < iterations; index++) {
      pdfRefresh.push(await measure(() => page.reload().then(() => waitForReader(page, "pdf"))));
    }

    const pdfToEpub: number[] = [];
    const epubPaginationReady: number[] = [];
    const epubToPdf: number[] = [];
    for (let index = 0; index < iterations; index++) {
      pdfToEpub.push(await measure(() => switchBook(page, "epub")));
      epubPaginationReady.push(await measure(() => waitForPageCount(page)));
      epubToPdf.push(await measure(() => switchBook(page, "pdf")));
    }

    const pdfTurns: number[] = [];
    for (let index = 0; index < iterations; index++) {
      const before = await page.locator(".page-count").textContent();
      pdfTurns.push(
        await measure(async () => {
          await page.getByTitle("Next page").click();
          await expect(page.locator(".page-count")).not.toHaveText(before ?? "", {
            timeout: 30_000,
          });
        }),
      );
    }

    await switchBook(page, "epub");
    await waitForPageCount(page);
    const epubTurns: number[] = [];
    for (let index = 0; index < iterations; index++) {
      const before = await page.locator(".page-count").textContent();
      epubTurns.push(
        await measure(async () => {
          await page.getByTitle("Next page").click();
          await expect(page.locator(".page-count")).not.toHaveText(before ?? "", {
            timeout: 30_000,
          });
        }),
      );
    }

    await page.goto(switchingUrl("epub"));
    await waitForReader(page, "epub");
    await waitForPageCount(page);
    const epubRefresh: number[] = [];
    for (let index = 0; index < iterations; index++) {
      epubRefresh.push(
        await measure(async () => {
          await page.reload();
          await waitForReader(page, "epub");
          await waitForPageCount(page);
        }),
      );
    }

    const report = {
      iterations,
      fixturePaths: { pdf: pdfPath, epub: epubPath },
      fixtureBytes: {
        pdf: pdfPath === "/fixtures/moby-dick.pdf" ? 1_544_566 : null,
        epub: epubPath === "/fixtures/dorian.epub" ? 556_798 : null,
      },
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
    await context.close();
  });
});
