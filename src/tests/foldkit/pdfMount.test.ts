// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { Runtime } from "foldkit";
import { m } from "foldkit/message";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PdfDocumentLoadFailed,
  PdfDocumentReady,
  PdfSpreadRendered,
  makePdfDocumentMount,
  pdfSearchAnchors,
  type PdfMountEnvironment,
  type PdfMountMessage,
  type PdfRenderTask,
} from "../../client/foldkit/mounts/pdf.ts";
import { pageGeometry, type PDFDocumentProxy } from "../../client/logic/sources/pdf.ts";

const MOBY_DICK = readFileSync(`${process.cwd()}/assets/moby-dick.pdf`);
const WORKER_PATH = `${process.cwd()}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`;

type ShimTarget = Uint8Array | Map<unknown, unknown> | PromiseConstructor;

function ensureMember(target: ShimTarget, name: string, value: unknown): void {
  if (name in target) return;
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
}

// jsdom's realm predates the builtins pdf.js parsing relies on and provides no
// canvas backend. These shims make the *parsing* half of pdf.js runnable here;
// rasterization stays a seam the tests drive, because jsdom cannot rasterize.
function installPdfJsBrowserShims(): void {
  ensureMember(Uint8Array.prototype, "toHex", function toHex(this: Uint8Array) {
    return [...this].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  });
  ensureMember(Uint8Array.prototype, "toBase64", function toBase64(this: Uint8Array) {
    return Buffer.from(this).toString("base64");
  });
  ensureMember(Map.prototype, "getOrInsertComputed", function getOrInsertComputed<
    K,
    V,
  >(this: Map<K, V>, key: K, compute: (key: K) => V) {
    if (!this.has(key)) this.set(key, compute(key));
    return this.get(key);
  });
  ensureMember(Promise, "try", (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
    Promise.resolve().then(() => fn(...args)),
  );
  // pdf.js only probes for these constructors at import time in a DOM realm.
  vi.stubGlobal("DOMMatrix", function DOMMatrixStub() {});
  vi.stubGlobal("Path2D", function Path2DStub() {});
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  );
}

// The application loader resolves the worker through a Vite asset URL, which
// only exists when the app is served; under Node the worker is a real file.
async function loadRealDocument(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_PATH;
  return pdfjs.getDocument({ data: bytes }).promise;
}

const mobyDickBytes = (): Promise<ArrayBuffer> =>
  new File([new Uint8Array(MOBY_DICK)], "moby-dick.pdf").arrayBuffer();

const settledTask = (): PdfRenderTask => ({ promise: Promise.resolve(), cancel: () => {} });

interface PendingTask extends PdfRenderTask {
  cancelled: number;
}
// Never settles on its own; only cancellation ends it, exactly like a pdf.js
// render task abandoned by a teardown.
const pendingTask = (): PendingTask => {
  const task: PendingTask = {
    cancelled: 0,
    promise: new Promise<void>(() => {}),
    cancel: () => {
      task.cancelled += 1;
    },
  };
  return task;
};

const testEnvironment = (overrides: Partial<PdfMountEnvironment> = {}): PdfMountEnvironment => ({
  loadSource: mobyDickBytes,
  loadDocument: loadRealDocument,
  rasterize: settledTask,
  loadTextLayerBuilder: null,
  devicePixelRatio: () => 1,
  cacheDocumentsAcrossMounts: false,
  ...overrides,
});

const OpenedSource = m("OpenedSource", { sourceId: Schema.String });
const Model = Schema.Struct({ sourceId: Schema.String, page: Schema.Number });
type Model = typeof Model.Type;
type Message = PdfMountMessage | typeof OpenedSource.Type;

// One reader element per source: the keyed element makes a source switch a
// destroy/insert, which is what releases the prior Mount's live resources.
function runReader(environment: PdfMountEnvironment) {
  const received: Message[] = [];
  const container = document.createElement("div");
  container.id = "foldkit-pdf-mount-test";
  document.body.appendChild(container);
  const PdfDocument = makePdfDocumentMount(environment);

  const handle = Runtime.embed(
    Runtime.makeElement<Model, Message>({
      Model,
      container,
      init: () => [{ sourceId: "source-a", page: 1 }, []],
      update: (model, message) => {
        received.push(message);
        return [
          message._tag === "OpenedSource" ? { ...model, sourceId: message.sourceId } : model,
          [],
        ];
      },
      view: (model, h) =>
        h.main(
          [],
          [
            h.button([h.OnClick(OpenedSource({ sourceId: "source-b" }))], ["switch"]),
            h.div(
              [
                h.Key(`pdf:${model.sourceId}`),
                h.OnMount(
                  PdfDocument({
                    sourceId: model.sourceId,
                    initialPage: model.page,
                    zoom: 100,
                    layout: "single",
                  }),
                ),
              ],
              [],
            ),
          ],
        ),
      devTools: false,
      slow: false,
    }),
  );
  return { handle, received };
}

const messagesOf = (received: readonly Message[], tag: Message["_tag"]) =>
  received.filter((message) => message._tag === tag);

const switchSource = () => document.querySelector("button")?.click();

describe("PDF Foldkit Mount", () => {
  beforeEach(() => {
    installPdfJsBrowserShims();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("acquires the real document and publishes ready and rendered events", async () => {
    const { handle, received } = runReader(testEnvironment());

    await vi.waitFor(() => expect(messagesOf(received, "PdfSpreadRendered")).toHaveLength(1), {
      timeout: 20_000,
    });
    const [ready] = messagesOf(received, "PdfDocumentReady");
    const [rendered] = messagesOf(received, "PdfSpreadRendered");
    expect(Schema.is(PdfDocumentReady)(ready) && ready.totalPages).toBe(468);
    expect(Schema.is(PdfDocumentReady)(ready) && ready.title).toBe("Herman Melville, Moby Dick");
    expect(Schema.is(PdfSpreadRendered)(rendered) && rendered.pages).toEqual([1]);
    expect(Schema.is(PdfSpreadRendered)(rendered) && rendered.atStart).toBe(true);
    // Reading position follows the render, so the Model never holds a handle.
    expect(messagesOf(received, "PdfPositionChanged").length).toBeGreaterThan(0);
    // The reader DOM belongs to the Mount, not to the view.
    expect(document.querySelectorAll(".pdf-scroller")).toHaveLength(1);

    handle.dispose();
    await vi.waitFor(() => expect(document.querySelector(".pdf-scroller")).toBeNull());
  }, 30_000);

  it("cancels an in-flight page render task when the element is released", async () => {
    const tasks: PendingTask[] = [];
    const { handle, received } = runReader(
      testEnvironment({
        rasterize: () => {
          const task = pendingTask();
          tasks.push(task);
          return task;
        },
      }),
    );

    await vi.waitFor(() => expect(tasks).toHaveLength(1), { timeout: 20_000 });
    expect(tasks[0]?.cancelled).toBe(0);
    expect(messagesOf(received, "PdfSpreadRendered")).toHaveLength(0);

    handle.dispose();
    await vi.waitFor(() => expect(tasks[0]?.cancelled).toBe(1));
    expect(document.querySelector(".pdf-scroller")).toBeNull();
    // A cancelled rasterization never claims to have rendered a spread.
    expect(messagesOf(received, "PdfSpreadRendered")).toHaveLength(0);
  }, 30_000);

  it("releases the prior document and render task when the source switches", async () => {
    const tasks: PendingTask[] = [];
    const opened: string[] = [];
    const documents: PDFDocumentProxy[] = [];
    const { handle, received } = runReader(
      testEnvironment({
        loadSource: (sourceId) => {
          opened.push(sourceId);
          return mobyDickBytes();
        },
        loadDocument: async (bytes) => {
          const doc = await loadRealDocument(bytes);
          documents.push(doc);
          return doc;
        },
        rasterize: () => {
          const task = pendingTask();
          tasks.push(task);
          return task;
        },
      }),
    );

    await vi.waitFor(() => expect(tasks).toHaveLength(1), { timeout: 20_000 });
    switchSource();

    await vi.waitFor(() => expect(opened).toEqual(["source-a", "source-b"]), { timeout: 20_000 });
    expect(tasks[0]?.cancelled).toBe(1);
    await vi.waitFor(() => expect(documents[0]?.loadingTask.destroyed).toBe(true));
    await vi.waitFor(() => expect(messagesOf(received, "PdfDocumentReady")).toHaveLength(2));
    // The replacement element owns exactly one reader; the prior one is gone.
    expect(document.querySelectorAll(".pdf-scroller")).toHaveLength(1);

    handle.dispose();
    await vi.waitFor(() => expect(documents[1]?.loadingTask.destroyed).toBe(true));
  }, 40_000);

  it("publishes a load failure and still releases the element's resources", async () => {
    const { handle, received } = runReader(
      testEnvironment({
        loadSource: () =>
          new File([new TextEncoder().encode("this is not a pdf")], "broken.pdf").arrayBuffer(),
      }),
    );

    await vi.waitFor(() => expect(messagesOf(received, "PdfDocumentLoadFailed")).toHaveLength(1), {
      timeout: 20_000,
    });
    const [failure] = messagesOf(received, "PdfDocumentLoadFailed");
    expect(Schema.is(PdfDocumentLoadFailed)(failure) && failure.sourceId).toBe("source-a");
    expect(Schema.is(PdfDocumentLoadFailed)(failure) && failure.message).not.toBe("");
    expect(messagesOf(received, "PdfDocumentReady")).toHaveLength(0);

    handle.dispose();
    await vi.waitFor(() => expect(document.querySelector(".pdf-scroller")).toBeNull());
  }, 30_000);

  it("destroys a document that finishes loading after the element was released", async () => {
    const late = await loadRealDocument(await mobyDickBytes());
    let deliver!: (doc: PDFDocumentProxy) => void;
    const { handle } = runReader(
      testEnvironment({
        loadDocument: () =>
          new Promise<PDFDocumentProxy>((resolve) => {
            deliver = resolve;
          }),
      }),
    );

    await vi.waitFor(() => expect(deliver).toBeDefined(), { timeout: 20_000 });
    handle.dispose();
    // Effect interruption cannot cancel the underlying pdf.js promise, so the
    // handle only becomes reachable after release and must still be destroyed.
    deliver(late);
    await vi.waitFor(() => expect(late.loadingTask.destroyed).toBe(true));
  }, 30_000);

  it("resolves in-page search against captured geometry without touching the DOM", async () => {
    const doc = await loadRealDocument(await mobyDickBytes());
    const geometry = new Map([[1, await pageGeometry(await doc.getPage(1))]]);
    const word = geometry.get(1)?.text.trim().split(/\s+/u)[1] ?? "";

    const anchors = pdfSearchAnchors(geometry, word);
    expect(word).not.toBe("");
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors[0]).toMatchObject({ kind: "pdf-text", page: 1 });
    expect(pdfSearchAnchors(geometry, "zzzunlikelyquery")).toEqual([]);
    await doc.loadingTask.destroy();
  }, 30_000);
});
