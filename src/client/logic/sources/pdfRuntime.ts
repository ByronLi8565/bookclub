import { Schema } from "effect";
import type * as PdfjsModule from "pdfjs-dist";
import type * as PdfViewerModule from "pdfjs-dist/web/pdf_viewer.mjs";

const AssetPath = Schema.String.check(Schema.isPattern(/^\/(?:assets|node_modules)\//u));
const RuntimeAssets = Schema.Struct({ parser: AssetPath, viewer: AssetPath, worker: AssetPath });
const decodeAssets = Schema.decodeUnknownSync(RuntimeAssets);

interface PdfRuntime {
  readonly lib: typeof PdfjsModule;
  readonly viewer: typeof PdfViewerModule;
  readonly worker: PdfjsModule.PDFWorker;
}

let runtimePromise: Promise<PdfRuntime> | null = null;
let attemptId = 0;

async function acquireRuntime(): Promise<PdfRuntime> {
  const response = await fetch("/assets/pdf-runtime.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`PDF runtime lookup failed (${response.status}).`);
  const assets = decodeAssets(await response.json());
  // A failed module import is cached by the browser. A fresh URL lets an
  // automatic retry actually fetch again, including after a deployment swap.
  const attempt = attemptId++;
  const assetUrl = (path: string): string => `${path}?attempt=${attempt}`;
  const lib: typeof PdfjsModule = await import(/* @vite-ignore */ assetUrl(assets.parser));
  lib.GlobalWorkerOptions.workerSrc = assetUrl(assets.worker);
  // SAFETY: TextLayerBuilder reads this documented global as the same PDF.js module shape.
  (globalThis as { pdfjsLib?: typeof PdfjsModule }).pdfjsLib = lib;
  const worker = new lib.PDFWorker();
  try {
    const viewerPromise: Promise<typeof PdfViewerModule> = import(
      /* @vite-ignore */ assetUrl(assets.viewer)
    );
    const [viewer] = await Promise.all([viewerPromise, worker.promise]);
    return { lib, viewer, worker };
  } catch (error) {
    worker.destroy();
    throw error;
  }
}

/** Keep a ready worker and all its modules for the tab's lifetime. No later
 * document needs to fetch a worker whose asset may have retired meanwhile. */
export function loadPdfRuntime(): Promise<PdfRuntime> {
  runtimePromise ??= acquireRuntime()
    .catch(() => acquireRuntime())
    .catch((error: unknown) => {
      runtimePromise = null;
      throw new Error("The PDF reader is temporarily unavailable.", { cause: error });
    });
  return runtimePromise;
}
