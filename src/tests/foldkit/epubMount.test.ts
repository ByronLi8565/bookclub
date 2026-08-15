// @vitest-environment jsdom
//
// epub.js cannot complete a render under jsdom: `renderTo` builds its container
// and iframe, but the srcdoc document never finishes loading and jsdom `Range`
// has no `getBoundingClientRect`, so `rendition.display()` never settles. These
// tests therefore drive the Mount's lifecycle contract through the `EpubEngine`
// seam, and use the real `assets/dorian.epub` fixture for everything that does
// run headless: byte loading, `Book` parsing, and the reader built over the live
// book. `epubJsEngine`'s own DOM ownership is covered by acquiring and releasing
// it mid-render; the rendered result stays with the browser suites.

import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import ePub from "epubjs";
import { Runtime } from "foldkit";
import { m } from "foldkit/message";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  epubJsEngine,
  makeEpubMount,
  type EpubEngine,
  type EpubMountMessage,
  type EpubPlace,
  type EpubSelectionReading,
  type EpubSession,
} from "../../client/foldkit/mounts/epub.ts";

const dorianBytes = (): ArrayBuffer => {
  // A jsdom-realm ArrayBuffer; JSZip rejects node's Buffer ArrayBuffer.
  const bytes = new Uint8Array(readFileSync("assets/dorian.epub"));
  return bytes.buffer;
};

const A_PLACE: EpubPlace = {
  spineIndex: 3,
  cfi: "epubcfi(/6/8!/4/2/2)",
  page: 1,
  atStart: false,
  atEnd: false,
};

interface FakeEngine {
  engine: EpubEngine;
  lifecycle: string[];
  sessions: FakeSession[];
  latest: () => FakeSession;
}

interface FakeSession extends EpubSession {
  moved: () => void;
  select: (selection: EpubSelectionReading | null) => void;
}

interface FakeEngineOptions {
  load?: (sourceId: string) => Promise<string | null>;
}

function makeFakeEngine({ load }: FakeEngineOptions = {}): FakeEngine {
  const lifecycle: string[] = [];
  const sessions: FakeSession[] = [];

  const engine: EpubEngine = ({ element, spread }) => {
    const id = `source-${sessions.length + 1}`;
    lifecycle.push(`created:${spread}`);
    let listener: (() => void) | null = null;
    let selection: EpubSelectionReading | null = null;
    const marker = element.ownerDocument.createElement("span");
    element.appendChild(marker);

    const session: FakeSession = {
      book: ePub(),
      async load(_bytes, initialCfi) {
        lifecycle.push(`load:${initialCfi ?? "start"}`);
        return load ? await load(id) : "Fake Book";
      },
      place: () => A_PLACE,
      selection: () => selection,
      onMoved(handler) {
        listener = handler;
        lifecycle.push("listening");
        return () => {
          listener = null;
          lifecycle.push("unlistened");
        };
      },
      turnPage: (direction) => {
        lifecycle.push(`turn:${direction}`);
        return Promise.resolve();
      },
      goTo: (cfi) => {
        lifecycle.push(`goTo:${cfi}`);
        return Promise.resolve();
      },
      setFontSize: (percent) => lifecycle.push(`fontSize:${percent}`),
      clearSelection: () => lifecycle.push("clearSelection"),
      destroy() {
        lifecycle.push("destroyed");
        marker.remove();
      },
      moved: () => listener?.(),
      select: (next) => {
        selection = next;
      },
    };
    sessions.push(session);
    return session;
  };

  return {
    engine,
    lifecycle,
    sessions,
    latest: () => {
      const session = sessions.at(-1);
      if (!session) throw new Error("no session created yet");
      return session;
    },
  };
}

const SelectedSource = m("SelectedSource", { sourceId: Schema.NullOr(Schema.String) });

const Model = Schema.Struct({
  sourceId: Schema.NullOr(Schema.String),
  log: Schema.Array(Schema.String),
});
type Model = typeof Model.Type;
type Message = typeof SelectedSource.Type | EpubMountMessage;

function describeMessage(message: EpubMountMessage): string {
  switch (message._tag) {
    case "OpenedEpub":
      return `OpenedEpub:${message.sourceId}:${message.title ?? "untitled"}:${message.place?.cfi ?? "nowhere"}`;
    case "MovedEpub":
      return `MovedEpub:${message.sourceId}:${message.place.cfi ?? "nowhere"}`;
    case "SelectedEpubText":
      return `SelectedEpubText:${message.sourceId}:${message.quote}`;
    case "ClearedEpubSelection":
      return `ClearedEpubSelection:${message.sourceId}`;
    case "FailedEpubLoad":
      return `FailedEpubLoad:${message.sourceId}:${message.message}`;
  }
}

function startReader(adapter: ReturnType<typeof makeEpubMount>, initialSourceId: string | null) {
  const container = document.createElement("div");
  container.id = "foldkit-epub-mount-test";
  document.body.appendChild(container);

  return Runtime.embed(
    Runtime.makeElement<Model, Message>({
      Model,
      container,
      init: () => [{ sourceId: initialSourceId, log: [] }, []],
      update: (model, message) => [
        message._tag === "SelectedSource"
          ? { ...model, sourceId: message.sourceId }
          : { ...model, log: [...model.log, describeMessage(message)] },
        [],
      ],
      view: (model, h) =>
        h.main(
          [],
          [
            h.button([h.OnClick(SelectedSource({ sourceId: "a" }))], ["a"]),
            h.button([h.OnClick(SelectedSource({ sourceId: "b" }))], ["b"]),
            h.button([h.OnClick(SelectedSource({ sourceId: null }))], ["none"]),
            h.pre([], [model.log.join("\n")]),
            ...(model.sourceId === null
              ? []
              : [
                  h.div(
                    [
                      h.Key(model.sourceId),
                      h.OnMount(
                        adapter.Mount({
                          sourceId: model.sourceId,
                          initialCfi: null,
                          spread: "auto",
                          fontSizePercent: 100,
                        }),
                      ),
                    ],
                    [],
                  ),
                ]),
          ],
        ),
      devTools: false,
      slow: false,
    }),
  );
}

const log = () => document.querySelector("pre")?.textContent ?? "";
const clickButton = (label: string) => {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!button) throw new Error(`no ${label} button`);
  button.click();
};

describe("EPUB Foldkit Mount", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("acquires a session, loads the source, and publishes the opened book", async () => {
    const fake = makeFakeEngine();
    const adapter = makeEpubMount({
      loadSource: () => Promise.resolve(dorianBytes()),
      engine: fake.engine,
    });
    const handle = startReader(adapter, "a");

    await vi.waitFor(() => expect(log()).toContain("OpenedEpub:a:Fake Book:epubcfi("));
    expect(fake.lifecycle).toEqual(["created:auto", "listening", "load:start"]);

    handle.dispose();
  });

  it("publishes location changes from the live rendition", async () => {
    const fake = makeFakeEngine();
    const adapter = makeEpubMount({
      loadSource: () => Promise.resolve(dorianBytes()),
      engine: fake.engine,
    });
    const handle = startReader(adapter, "a");
    await vi.waitFor(() => expect(log()).toContain("OpenedEpub:a"));

    fake.latest().moved();
    await vi.waitFor(() => expect(log()).toContain("MovedEpub:a:epubcfi(/6/8!/4/2/2)"));

    handle.dispose();
  });

  it("publishes selection transitions polled from the live documents", async () => {
    const fake = makeFakeEngine();
    const adapter = makeEpubMount({
      loadSource: () => Promise.resolve(dorianBytes()),
      engine: fake.engine,
    });
    const handle = startReader(adapter, "a");
    await vi.waitFor(() => expect(log()).toContain("OpenedEpub:a"));

    fake.latest().select({ cfi: "epubcfi(/6/8!/4/2/6)", quote: "yellow", point: { x: 4, y: 8 } });
    await vi.waitFor(() => expect(log()).toContain("SelectedEpubText:a:yellow"), { timeout: 3000 });

    fake.latest().select(null);
    await vi.waitFor(() => expect(log()).toContain("ClearedEpubSelection:a"), { timeout: 3000 });

    handle.dispose();
  });

  it("releases the previous session when the selected source changes", async () => {
    const fake = makeFakeEngine();
    const adapter = makeEpubMount({
      loadSource: () => Promise.resolve(dorianBytes()),
      engine: fake.engine,
    });
    const handle = startReader(adapter, "a");
    await vi.waitFor(() => expect(log()).toContain("OpenedEpub:a"));

    clickButton("b");
    await vi.waitFor(() => expect(log()).toContain("OpenedEpub:b"));
    await vi.waitFor(() => expect(fake.lifecycle).toContain("destroyed"));
    expect(fake.sessions).toHaveLength(2);
    expect(fake.lifecycle.filter((entry) => entry === "destroyed")).toHaveLength(1);
    expect(fake.lifecycle).toContain("unlistened");

    // Commands must reach the newly acquired session, never the released one.
    await Effect.runPromise(adapter.turnPage("next"));
    expect(fake.lifecycle.at(-1)).toBe("turn:next");
    const first = fake.sessions[0];
    fake.latest().moved();
    first?.moved();
    await vi.waitFor(() =>
      expect(
        log()
          .split("\n")
          .filter((line) => line.startsWith("MovedEpub:b")),
      ).toHaveLength(1),
    );

    handle.dispose();
  });

  it("removes listeners and destroys the session when the element unmounts", async () => {
    const fake = makeFakeEngine();
    const adapter = makeEpubMount({
      loadSource: () => Promise.resolve(dorianBytes()),
      engine: fake.engine,
    });
    const handle = startReader(adapter, "a");
    await vi.waitFor(() => expect(log()).toContain("OpenedEpub:a"));
    const session = fake.latest();

    clickButton("none");
    await vi.waitFor(() => expect(fake.lifecycle).toContain("destroyed"));
    expect(fake.lifecycle).toEqual([
      "created:auto",
      "listening",
      "load:start",
      "unlistened",
      "destroyed",
    ]);
    expect(document.querySelector("main span")).toBeNull();

    const before = log();
    session.moved();
    session.select({ cfi: "epubcfi(/6/2)", quote: "late", point: { x: 0, y: 0 } });
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
    expect(log()).toBe(before);

    // Commands taken after release must not reach a destroyed session.
    await Effect.runPromise(adapter.turnPage("next"));
    expect(fake.lifecycle.at(-1)).toBe("destroyed");

    handle.dispose();
  });

  it("publishes a load failure and still releases the acquired session", async () => {
    const fake = makeFakeEngine();
    const adapter = makeEpubMount({
      loadSource: () => Promise.reject(new Error("source download failed")),
      engine: fake.engine,
    });
    const handle = startReader(adapter, "a");

    await vi.waitFor(() => expect(log()).toContain("FailedEpubLoad:a:source download failed"));
    expect(log()).not.toContain("OpenedEpub");
    expect(fake.lifecycle).toEqual(["created:auto", "listening"]);

    clickButton("none");
    await vi.waitFor(() => expect(fake.lifecycle).toContain("destroyed"));
    expect(fake.lifecycle).toEqual(["created:auto", "listening", "unlistened", "destroyed"]);

    handle.dispose();
  });

  it("publishes a parse failure raised while opening the book", async () => {
    const fake = makeFakeEngine({
      load: () => Promise.reject(new Error("no displayable section")),
    });
    const adapter = makeEpubMount({
      loadSource: () => Promise.resolve(dorianBytes()),
      engine: fake.engine,
    });
    const handle = startReader(adapter, "a");

    await vi.waitFor(() => expect(log()).toContain("FailedEpubLoad:a:no displayable section"));

    handle.dispose();
    await vi.waitFor(() => expect(fake.lifecycle).toContain("destroyed"));
  });

  it("opens the real dorian.epub bytes and exposes a reader over the live book", async () => {
    const parseOnlyEngine: EpubEngine = () => {
      const book = ePub();
      return {
        book,
        async load(bytes) {
          await book.open(bytes, "binary");
          await book.ready;
          const metadata = await book.loaded.metadata.catch(() => null);
          return metadata?.title?.trim() || null;
        },
        place: () => null,
        selection: () => null,
        onMoved: () => () => {},
        turnPage: () => Promise.resolve(),
        goTo: () => Promise.resolve(),
        setFontSize: () => {},
        clearSelection: () => {},
        destroy: () => book.destroy(),
      };
    };
    const adapter = makeEpubMount({
      loadSource: () => Promise.resolve(dorianBytes()),
      engine: parseOnlyEngine,
    });
    const handle = startReader(adapter, "a");

    await vi.waitFor(() => expect(log()).toMatch(/OpenedEpub:a:.*Dorian Gray/u), {
      timeout: 20000,
    });
    expect(await Effect.runPromise(adapter.reader.search("forehead"))).toHaveLength(12);

    handle.dispose();
    // The reader is renderer-independent but book-bound: with no live session it
    // reports nothing rather than holding the released book alive.
    await vi.waitFor(async () =>
      expect(await Effect.runPromise(adapter.reader.search("forehead"))).toEqual([]),
    );
  }, 30000);

  it("acquires and releases real epub.js resources while its render is still pending", async () => {
    const adapter = makeEpubMount({
      loadSource: () => Promise.resolve(dorianBytes()),
      engine: epubJsEngine,
    });
    const handle = startReader(adapter, "a");

    // `display()` never settles under jsdom, so the Mount is released mid-load:
    // the rendition it attached must still be torn down deterministically.
    await vi.waitFor(() => expect(document.querySelector(".epub-container")).not.toBeNull(), {
      timeout: 20000,
    });
    expect(log()).not.toContain("OpenedEpub");

    clickButton("none");
    await vi.waitFor(() => expect(document.querySelector(".epub-container")).toBeNull());

    handle.dispose();
  }, 30000);
});
