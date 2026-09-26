import { Effect, Queue, Schedule, Schema, Stream } from "effect";
import type { Book, Contents, Rendition } from "epubjs";
import EpubCFI from "epubjs/src/epubcfi.js";
import type Navigation from "epubjs/types/navigation";
import type Section from "epubjs/types/section";
import { Mount } from "foldkit";
import { m } from "foldkit/message";
import {
  expandToWordBoundaries,
  popupPoint,
  quoteForRange,
  type HighlightAnchor,
  type SourceReader,
} from "../../logic/notes/highlights.ts";
import { QuoteSelector } from "../../../shared/types/notes.ts";
import {
  epubPageCount,
  measureEpubPagination,
  type EpubPagination,
} from "../../logic/reader/epubPagination.ts";
import { makeEpubFontSize } from "../../logic/reader/epubFontSize.ts";
import {
  getCachedEpubPagination,
  putCachedEpubPagination,
} from "../../logic/reader/epubPaginationCache.ts";
import { makeEpubReader } from "../../logic/reader/epubReader.ts";
import { makeLayoutQueue } from "../../logic/reader/layoutQueue.ts";
import {
  failureMessage,
  makeLiveSlot,
  nextFrames,
  onForegroundResume,
} from "../../logic/mountSupport.ts";

declare module "epubjs/types/utils/queue" {
  export default interface Queue {
    tick: (callback: () => void) => void;
  }
}

export const EpubSpread = Schema.Literals(["auto", "none"]);
export type EpubSpread = typeof EpubSpread.Type;

// Where the reader sits, in the renderer's own terms. Turning this into a page
// count belongs to the pagination helpers, not to the Mount.
export const EpubPageCount = Schema.Struct({
  page: Schema.Number,
  total: Schema.Number,
  percentage: Schema.Number,
});
export type EpubPageCount = typeof EpubPageCount.Type;

export const EpubPlace = Schema.Struct({
  spineIndex: Schema.Number,
  cfi: Schema.NullOr(Schema.String),
  endCfi: Schema.optionalKey(Schema.String),
  page: Schema.Number,
  /** Where this place falls in the measured book. Zero pages until a
   *  pagination measurement has landed. */
  count: EpubPageCount,
  atStart: Schema.Boolean,
  atEnd: Schema.Boolean,
});
export type EpubPlace = typeof EpubPlace.Type;

const epubCfi = new EpubCFI();

/** Whether a text anchor is visible in the rendition's current page or spread.
 * CFI ordering is independent of pagination, font size, and single/double-page
 * layout, which is why bookmarks remain stable through all three. */
export function cfiIsVisible(anchor: string, start: string, end: string): boolean {
  try {
    return epubCfi.compare(start, anchor) <= 0 && epubCfi.compare(anchor, end) <= 0;
  } catch {
    return false;
  }
}

export const EpubPoint = Schema.Struct({ x: Schema.Number, y: Schema.Number });
export type EpubPoint = typeof EpubPoint.Type;

export const OpenedEpub = m("OpenedEpub", {
  sourceId: Schema.String,
  title: Schema.NullOr(Schema.String),
  place: Schema.NullOr(EpubPlace),
});
export const MovedEpub = m("MovedEpub", { sourceId: Schema.String, place: EpubPlace });
/** The same place, counted again after the layout changed under it. */
export const RelaidOutEpub = m("RelaidOutEpub", { sourceId: Schema.String, place: EpubPlace });
export const SelectedEpubText = m("SelectedEpubText", {
  sourceId: Schema.String,
  cfi: Schema.String,
  quote: QuoteSelector,
  point: EpubPoint,
});
export const ClearedEpubSelection = m("ClearedEpubSelection", { sourceId: Schema.String });
export const ClickedEpubHighlight = m("ClickedEpubHighlight", {
  sourceId: Schema.String,
  highlightId: Schema.String,
});
export const FailedEpubLoad = m("FailedEpubLoad", {
  sourceId: Schema.String,
  message: Schema.String,
});

export type EpubMountMessage =
  | typeof OpenedEpub.Type
  | typeof MovedEpub.Type
  | typeof RelaidOutEpub.Type
  | typeof SelectedEpubText.Type
  | typeof ClearedEpubSelection.Type
  | typeof ClickedEpubHighlight.Type
  | typeof FailedEpubLoad.Type;

export interface EpubSelectionReading {
  cfi: string;
  quote: QuoteSelector;
  point: EpubPoint;
}

// The live imperative surface the Mount owns for one open book. Everything here
// is renderer-bound; renderer-independent anchoring, search, and pagination stay
// in the reader engine helpers.
export interface EpubSession {
  readonly book: Book;
  load(bytes: ArrayBuffer, initialCfi: string | null): Promise<string | null>;
  place(): EpubPlace | null;
  selection(): EpubSelectionReading | null;
  onMoved(handler: () => void): () => void;
  turnPage(direction: "next" | "previous"): Promise<void>;
  goTo(cfi: string): Promise<void>;
  setFontSize(points: number): Promise<void>;
  setColors(colors: EpubColors): void;
  clearSelection(): void;
  /** Paint the given highlights and erase every other painted one. epub.js
   *  annotations are keyed by CFI, so the session keeps its own id-to-CFI map
   *  rather than asking the rendition what it has drawn. */
  syncHighlights(highlights: readonly PaintedHighlight[]): void;
  /** The one search match the reader is standing on, painted in its own class
   *  so it survives independently of committed highlights. */
  setSearchHighlight(cfi: string | null): void;
  setSpread(spread: EpubSpread): Promise<void>;
  /** Every layout change (spread, text size, viewport) relayouts in place, and
   *  once the book is counted again at the new layout the handler gets the
   *  re-counted place. */
  onRelaidOut(handler: (place: EpubPlace) => void): () => void;
  destroy(): void;
}

/** A highlight the reader wants painted, in the renderer's own terms. */
export interface PaintedHighlight {
  id: string;
  cfi: string;
}

/** The book's own stylesheet sets its own colors, so epub.js needs `!important`
 *  to actually repaint the page rather than being outranked by it. */
export interface EpubColors {
  readonly background: string;
  readonly text: string;
  readonly link: string;
}

export interface EpubSessionOptions {
  sourceId: string;
  element: Element;
  spread: EpubSpread;
  fontSizePoints: number;
  colors: EpubColors;
  onHighlightClick: (id: string) => void;
}

// Test engines are synchronous; the browser engine loads epub.js on demand.
// The Mount awaits either form before opening bytes and owns teardown from then on.
export type EpubEngine = (options: EpubSessionOptions) => EpubSession | Promise<EpubSession>;

/** Everything that decides where text falls on the page. */
interface EpubLayout {
  readonly spread: EpubSpread;
  readonly fontSize: number;
  readonly width: number;
  readonly height: number;
}

const sameLayout = (a: EpubLayout, b: EpubLayout): boolean =>
  a.spread === b.spread &&
  a.fontSize === b.fontSize &&
  a.width === b.width &&
  a.height === b.height;

const SELECTION_POLL = Schedule.spaced("300 millis");

function readingStartHref(navigation: Navigation): string | undefined {
  return navigation.landmark?.("bodymatter")?.href;
}

function linearSpineTarget(book: Book, target: string | null | undefined): string | undefined {
  if (!target) return undefined;
  try {
    return book.spine.get(target)?.linear ? target : undefined;
  } catch {
    return undefined;
  }
}

function firstLinearSpineTarget(book: Book): string | undefined {
  let target: string | undefined;
  book.spine.each((section: Section) => {
    if (target === undefined && section.linear) target = section.href;
  });
  return target;
}

function readPlace(rendition: Rendition, pagination: EpubPagination | null): EpubPlace | null {
  const currentLocation: unknown = rendition.currentLocation();
  // SAFETY: epub.js currentLocation uses this documented location shape after display.
  const location = currentLocation as
    | {
        start?: { index: number; cfi?: string; displayed?: { page: number } };
        end?: { cfi?: string };
        atStart?: boolean;
        atEnd?: boolean;
      }
    | undefined;
  const start = location?.start;
  if (!start?.displayed) return null;
  const place: EpubPlace = {
    spineIndex: start.index,
    cfi: start.cfi ?? null,
    page: start.displayed.page,
    count: epubPageCount(pagination, { spineIndex: start.index, page: start.displayed.page }),
    atStart: location?.atStart ?? false,
    atEnd: location?.atEnd ?? false,
  };
  return location?.end?.cfi === undefined ? place : { ...place, endCfi: location.end.cfi };
}

function readSelection(rendition: Rendition): EpubSelectionReading | null {
  const renditionContents: unknown = rendition.getContents();
  // SAFETY: epub.js getContents returns its Contents instances despite the incomplete declaration.
  const contents = renditionContents as Contents[];
  for (const content of contents) {
    const selection = content.window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) continue;
    const range = expandToWordBoundaries(selection.getRangeAt(0));
    if (range.toString().trim() === "") continue;
    const quote = quoteForRange(range, "epub-cfi");
    const frame = content.window.frameElement?.getBoundingClientRect();
    return {
      cfi: content.cfiFromRange(range),
      quote,
      point: popupPoint(range.getBoundingClientRect(), frame),
    };
  }
  return null;
}

function clearContentSelections(rendition: Rendition): void {
  const renditionContents: unknown = rendition.getContents();
  // SAFETY: epub.js getContents returns its Contents instances despite the incomplete declaration.
  for (const content of renditionContents as Contents[]) {
    content.window.getSelection()?.removeAllRanges();
  }
}

const HIGHLIGHT_CLASS = "bc-highlight";
const SEARCH_HIGHLIGHT_CLASS = "bc-search";

/** Re-registers the whole "default" theme, since epub.js has no way to patch
 *  just the color rules within it — every call must restate the selection
 *  styles alongside whatever colors are current. */
function applyEpubTheme(rendition: Rendition, colors: EpubColors): void {
  rendition.themes.default({
    body: {
      "-webkit-user-select": "text",
      "user-select": "text",
      background: `${colors.background} !important`,
      color: `${colors.text} !important`,
    },
    a: { color: `${colors.link} !important` },
  });
}

export const epubJsEngine = async ({
  sourceId,
  element,
  spread,
  fontSizePoints,
  colors,
  onHighlightClick,
}: EpubSessionOptions): Promise<EpubSession> => {
  const { default: ePub } = await import("epubjs");
  const book = ePub();
  const rendition = book.renderTo(element, {
    width: "100%",
    height: "100%",
    flow: "paginated",
    spread,
  });
  // epub.js already waits for a frame before reporting the final location.
  // Its command queue can advance as soon as the preceding task completes.
  rendition.q.tick = queueMicrotask;
  // Keyboard events inside the EPUB iframe do not bubble into the application
  // document. Re-dispatch them there so the one reader keyboard contract owns
  // arrows, layout toggles, search, and chrome regardless of where focus sits.
  const forwardKey = (event: KeyboardEvent) => {
    const forwarded = new KeyboardEvent("keydown", {
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      cancelable: true,
      bubbles: true,
    });
    if (!document.dispatchEvent(forwarded)) event.preventDefault();
  };
  const forwardPress = () => {
    element.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
  };
  // Listen on the iframe document itself: no event from this browsing context
  // can bubble to the application's document-level Foldkit Subscriptions. The
  // listeners die with the iframe, so there is nothing to remove on teardown.
  const bridgeContent = (content: Contents) => {
    content.document.addEventListener("keydown", forwardKey);
    content.document.addEventListener("mousedown", forwardPress, { passive: true });
    content.document.addEventListener("touchstart", forwardPress, { passive: true });
  };
  rendition.hooks.content.register(bridgeContent);
  let destroyed = false;
  const resizeRendition = rendition.resize.bind(rendition);
  // SAFETY: epub.js's declaration omits the manager that its own resize
  // implementation immediately dereferences. ResizeObserver may fire before
  // startup assigns it, which is why the added property remains optional.
  const renditionState = rendition as Rendition & { manager?: object };
  // epub.js can retain a queued resize after Rendition.destroy has discarded
  // that same manager. Keep both edge callbacks harmless.
  rendition.resize = (width, height) => {
    if (!destroyed && renditionState.manager) resizeRendition(width, height);
  };
  const drawn = new Map<string, string>();
  let searchCfi: string | null = null;
  let pagination: EpubPagination | null = null;
  applyEpubTheme(rendition, colors);
  const fontSize = makeEpubFontSize(rendition, fontSizePoints);

  // SAFETY: bound because epub.js reads `this.displaying` inside `display`, and
  // its public declaration accepts the same optional string target.
  const display = rendition.display.bind(rendition) as (target?: string) => Promise<void>;

  let opening: Promise<unknown> | null = null;
  let ready: Promise<void> | null = null;
  let lastTarget: string | null = null;

  const paintHighlight = (id: string, cfi: string) =>
    rendition.annotations.highlight(cfi, { id }, () => onHighlightClick(id), HIGHLIGHT_CLASS);
  const paintSearch = (cfi: string) =>
    rendition.annotations.highlight(cfi, {}, () => {}, SEARCH_HIGHLIGHT_CLASS);

  const syncHighlights = (highlights: readonly PaintedHighlight[]): void => {
    const wanted = new Map(highlights.map((highlight) => [highlight.id, highlight.cfi]));
    for (const [id, cfi] of drawn) {
      if (wanted.get(id) === cfi) continue;
      rendition.annotations.remove(cfi, "highlight");
      drawn.delete(id);
    }
    for (const [id, cfi] of wanted) {
      if (drawn.has(id)) continue;
      paintHighlight(id, cfi);
      drawn.set(id, cfi);
    }
  };

  const setSearchHighlight = (cfi: string | null): void => {
    if (searchCfi !== null && searchCfi !== cfi) {
      rendition.annotations.remove(searchCfi, "highlight");
      // Removing by CFI takes the committed annotation with it when both sit
      // on the same passage, so that one is drawn again.
      const committed = [...drawn].find(([, drawnCfi]) => drawnCfi === searchCfi);
      if (committed) paintHighlight(...committed);
    }
    searchCfi = cfi;
    if (cfi !== null) paintSearch(cfi);
  };

  // Everything that moves text on the page funnels into one relayout: the
  // layout the reader wants is recorded here, and a pass applies whatever
  // differs from what is drawn, redisplays the reader's place, and counts the
  // pages again at exactly that layout. The redisplay is also what moves every
  // highlight: epub.js re-injects each registered annotation, from the reflowed
  // text's geometry, whenever it renders a view.
  let wantedSpread = spread;
  let wantedFontSize = fontSizePoints;
  let drawnLayout: EpubLayout | null = null;
  let redrawRequired = false;
  let measureSeq = 0;
  const relaidOut = new Set<(place: EpubPlace) => void>();

  const countPages = async (layout: EpubLayout, superseded: () => boolean) => {
    const key = `${sourceId}:${Math.round(layout.width)}x${Math.round(layout.height)}:${layout.fontSize}:${layout.spread}`;
    const counted =
      getCachedEpubPagination(key) ??
      (await measureEpubPagination(
        book,
        layout.width,
        layout.height,
        layout.fontSize,
        layout.spread,
        superseded,
      ));
    if (counted === null || superseded()) return;
    pagination = counted;
    putCachedEpubPagination(key, counted);
    const place = readPlace(rendition, pagination);
    if (place) for (const handler of relaidOut) handler(place);
  };

  /** Measurement is expensive, so a newer layout abandons the count in flight. */
  const recount = (layout: EpubLayout) => {
    const seq = ++measureSeq;
    void countPages(layout, () => destroyed || seq !== measureSeq).catch(() => {});
  };

  const relayout = makeLayoutQueue(async () => {
    // A layout change can also move the reader pane's width, and the real
    // workspace animates it: let Foldkit patch the DOM and the pane settle
    // before epub.js measures its stage.
    await nextFrames();
    const pane = element.closest(".split-pane");
    if (pane) await Promise.allSettled(pane.getAnimations().map((animation) => animation.finished));
    if (
      ready === null ||
      !(await ready.then(
        () => true,
        () => false,
      ))
    )
      return;
    if (destroyed || !renditionState.manager) return;
    const next: EpubLayout = {
      spread: wantedSpread,
      fontSize: wantedFontSize,
      width: element.clientWidth,
      height: element.clientHeight,
    };
    if (next.width <= 0 || next.height <= 0) return;
    if (!redrawRequired && drawnLayout !== null && sameLayout(drawnLayout, next)) return;
    const target = readPlace(rendition, pagination)?.cfi ?? lastTarget;
    if (next.spread !== drawnLayout?.spread) rendition.spread(next.spread);
    if (next.fontSize !== drawnLayout?.fontSize) fontSize.set(next.fontSize);
    rendition.resize(next.width, next.height);
    if (target) await display(target);
    // Committed only once the redisplay drew, so a failed pass is retried by the next request.
    drawnLayout = next;
    redrawRequired = false;
    recount(next);
  });
  const requestRelayout = () => void relayout().catch(() => {});

  // A notification can already be queued when disconnect runs; the pass
  // checks `destroyed` before touching the dead rendition.
  const resizeObserver =
    typeof ResizeObserver === "function" ? new ResizeObserver(requestRelayout) : null;
  resizeObserver?.observe(element);
  // WebKit can discard a backgrounded page's rendering without resizing it.
  const stopResuming = onForegroundResume(() => {
    redrawRequired = true;
    requestRelayout();
  });

  return {
    book,
    async load(bytes, initialCfi) {
      const loading = (async () => {
        // `Book.open()` only waits for package unpacking. `book.opened` also
        // waits for archived resource replacements, which must settle before
        // this session may render or destroy the Resources object they use.
        const unpacked = book.open(bytes, "binary");
        opening = Promise.all([unpacked, book.opened]);
        await opening;
        const metadata = await book.loaded.metadata.catch(() => null);
        const navigation = await book.loaded.navigation.catch(() => null);
        // Try the most specific target first: a body-matter landmark can fail to
        // resolve to a spine item, so we end at the first explicitly linear spine
        // item rather than trusting epub.js's version-dependent default target.
        const candidates = [
          linearSpineTarget(book, initialCfi),
          linearSpineTarget(book, navigation ? readingStartHref(navigation) : undefined),
          firstLinearSpineTarget(book),
        ].filter((target, index, all): target is string => {
          return target !== undefined && all.indexOf(target) === index;
        });
        for (const target of candidates) {
          try {
            await display(target);
            lastTarget = readPlace(rendition, pagination)?.cfi ?? target;
            drawnLayout = {
              spread,
              fontSize: fontSizePoints,
              width: element.clientWidth,
              height: element.clientHeight,
            };
            recount(drawnLayout);
            return metadata?.title?.trim() || null;
          } catch {
            continue;
          }
        }
        throw new Error("No displayable section found in epub");
      })();
      const loaded = loading.then(() => {});
      // The caller of `load` reports the failure; `ready` only gates later
      // commands, which each handle a failed load themselves.
      loaded.catch(() => {});
      ready = loaded;
      return await loading;
    },
    place: () => readPlace(rendition, pagination),
    selection: () => readSelection(rendition),
    onMoved(handler) {
      const moved = () => {
        lastTarget = readPlace(rendition, pagination)?.cfi ?? lastTarget;
        handler();
      };
      rendition.on("relocated", moved);
      return () => rendition.off("relocated", moved);
    },
    async turnPage(direction) {
      const started = ready;
      if (started === null || destroyed) return;
      try {
        await started;
      } catch {
        return;
      }
      // epub.js delegates to `manager.prev/next`; a queued command can outlive
      // the manager during a book switch even though the Rendition object is
      // still reachable.
      if (destroyed || !renditionState.manager) return;
      await (direction === "next" ? rendition.next() : rendition.prev());
    },
    goTo: (cfi) => display(linearSpineTarget(book, cfi) ?? firstLinearSpineTarget(book)),
    setFontSize(points) {
      wantedFontSize = points;
      return relayout();
    },
    setColors(next) {
      applyEpubTheme(rendition, next);
    },
    clearSelection: () => clearContentSelections(rendition),
    syncHighlights,
    setSearchHighlight,
    setSpread(next) {
      wantedSpread = next;
      return relayout();
    },
    onRelaidOut(handler) {
      relaidOut.add(handler);
      return () => relaidOut.delete(handler);
    },
    destroy() {
      destroyed = true;
      stopResuming();
      fontSize.destroy();
      rendition.hooks.content.deregister(bridgeContent);
      resizeObserver?.disconnect();
      // The replacement Mount may acquire before epub.js is safe to destroy.
      // Release the old session's visible DOM immediately so two renditions
      // can never share the reader while its handles finish asynchronously.
      element.replaceChildren();
      // Neither half of epub.js can be torn down while the book is still
      // opening.
      //
      // `renderTo` queues `start` behind `book.opened`, and `Rendition.destroy`
      // drops the very book reference that queued task goes on to read. It
      // throws inside the library's own queue, where no caller can catch it,
      // and the reader is left on an empty frame. `Book.destroy` drops the
      // deferred `loading` map the display-options fetch resolves against,
      // which fails the same way.
      //
      // So both wait for the open to settle, and for the start it unblocks to
      // have run. A session torn down before it ever opened has nothing in
      // flight to wait for; one whose open failed never starts at all, so
      // waiting on `started` there would wait for ever.
      if (opening === null) {
        rendition.destroy();
        book.destroy();
        return;
      }
      void opening
        .then(
          () => rendition.started.catch(() => {}),
          () => {},
        )
        .then(() => {
          rendition.destroy();
          book.destroy();
        });
    },
  };
};

export interface EpubMountOptions {
  loadSource: (sourceId: string, groupRef: string) => Promise<ArrayBuffer>;
  engine?: EpubEngine;
}

// One EPUB adapter instance: a Mount that owns the live Book, Rendition, iframes
// and listeners for whichever source is currently displayed, plus the Commands
// surface (navigation, zoom, search) that acts on that live session. The Model
// keeps none of it — the Mount publishes domain Messages instead.
export function makeEpubMount({ loadSource, engine = epubJsEngine }: EpubMountOptions) {
  const live = makeLiveSlot<EpubSession>();

  const onLiveSession = <A>(fallback: A, use: (session: EpubSession) => Promise<A>) =>
    Effect.suspend(() => {
      const session = live.get();
      return session === null
        ? Effect.succeed(fallback)
        : // The rejection is the failure. Left to `tryPromise`'s own wrapper the
          // reader reports "An error occurred in Effect.tryPromise", which says
          // nothing about the book that would not open.
          Effect.tryPromise({ try: () => use(session), catch: (cause) => cause });
    });

  const EpubSource = Mount.defineStream(
    "EpubSource",
    {
      sourceId: Schema.String,
      // The club the book belongs to: a first open downloads it, and the
      // download is addressed by club reference.
      groupRef: Schema.String,
      initialCfi: Schema.NullOr(Schema.String),
      spread: EpubSpread,
      fontSizePoints: Schema.Number,
      colors: Schema.Struct({
        background: Schema.String,
        text: Schema.String,
        link: Schema.String,
      }),
    },
    OpenedEpub,
    MovedEpub,
    RelaidOutEpub,
    SelectedEpubText,
    ClearedEpubSelection,
    ClickedEpubHighlight,
    FailedEpubLoad,
  )(
    ({ sourceId, groupRef, initialCfi, spread, fontSizePoints, colors }) =>
      (element) =>
        Stream.callback<EpubMountMessage>((queue) =>
          Effect.gen(function* () {
            const emit = (message: EpubMountMessage) => {
              Queue.offerUnsafe(queue, message);
            };

            // Source I/O and the on-demand epub.js chunk are independent. Start
            // the bytes first so neither network request sits behind the other.
            const sourceBytes = yield* Effect.sync(() => {
              const pending = loadSource(sourceId, groupRef);
              void pending.catch(() => {});
              return pending;
            });

            // Keep the rejection itself, so what the reader is told is what
            // actually went wrong with the book.
            const reportFailure = (error: unknown) =>
              Effect.sync(() => emit(FailedEpubLoad({ sourceId, message: failureMessage(error) })));

            // The browser engine imports epub.js on demand, and that chunk can
            // fail to load (offline, or replaced by a newer deploy).
            const session = yield* live
              .acquire(
                Effect.tryPromise({
                  try: () =>
                    Promise.resolve(
                      engine({
                        sourceId,
                        element,
                        spread,
                        fontSizePoints,
                        colors,
                        onHighlightClick: (highlightId) =>
                          emit(ClickedEpubHighlight({ sourceId, highlightId })),
                      }),
                    ),
                  catch: (cause) => cause,
                }),
                (created) => created.destroy(),
              )
              .pipe(
                Effect.tapError(reportFailure),
                Effect.orElseSucceed(() => null),
              );
            if (session === null) return yield* Effect.never;

            yield* Effect.acquireRelease(
              Effect.sync(() => [
                session.onMoved(() => {
                  const place = session.place();
                  if (place) emit(MovedEpub({ sourceId, place }));
                }),
                session.onRelaidOut((place) => emit(RelaidOutEpub({ sourceId, place }))),
              ]),
              (unsubscribes) =>
                Effect.sync(() => unsubscribes.forEach((unsubscribe) => unsubscribe())),
            );

            const opened = yield* Effect.tryPromise({
              try: () => sourceBytes.then((bytes) => session.load(bytes, initialCfi)),
              catch: (cause) => cause,
            }).pipe(
              Effect.map((title) => ({ title })),
              Effect.tapError(reportFailure),
              Effect.orElseSucceed(() => null),
            );
            // A failed load keeps the scope open so the element's unmount, not
            // the failure, decides when the created rendition is destroyed.
            if (opened === null) return yield* Effect.never;

            emit(OpenedEpub({ sourceId, title: opened.title, place: session.place() }));

            // epub.js has no selection event; the reader watches the live
            // documents instead, and reports only transitions.
            let reported: string | null = null;
            return yield* Effect.sync(() => {
              const selection = session.selection();
              if (selection === null) {
                if (reported === null) return;
                reported = null;
                emit(ClearedEpubSelection({ sourceId }));
                return;
              }
              if (selection.cfi === reported) return;
              reported = selection.cfi;
              emit(SelectedEpubText({ sourceId, ...selection }));
            }).pipe(Effect.repeat(SELECTION_POLL));
          }),
        ),
  );

  const reader: SourceReader = makeEpubReader(() => live.get()?.book ?? null);

  return {
    Mount: EpubSource,
    reader,
    turnPage: (direction: "next" | "previous") =>
      onLiveSession(undefined, (session) => session.turnPage(direction)),
    goTo: (anchor: HighlightAnchor) =>
      anchor.kind === "epub-cfi"
        ? onLiveSession(undefined, (session) => session.goTo(anchor.value))
        : Effect.void,
    setFontSize: (points: number) =>
      onLiveSession(undefined, (session) => session.setFontSize(points)),
    setColors: (colors: EpubColors) =>
      Effect.sync(() => {
        live.get()?.setColors(colors);
      }),
    dismissSelection: Effect.sync(() => {
      live.get()?.clearSelection();
    }),
    syncHighlights: (highlights: readonly PaintedHighlight[]) =>
      Effect.sync(() => {
        live.get()?.syncHighlights(highlights);
      }),
    setSearchHighlight: (anchor: HighlightAnchor | null) =>
      Effect.sync(() => {
        live.get()?.setSearchHighlight(anchor?.kind === "epub-cfi" ? anchor.value : null);
      }),
    setSpread: (spread: EpubSpread) =>
      onLiveSession(undefined, (session) => session.setSpread(spread)),
  };
}
