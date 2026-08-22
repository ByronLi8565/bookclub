import { Effect, Queue, Schedule, Schema, Stream } from "effect";
import ePub, { EpubCFI, type Book, type Contents, type Rendition } from "epubjs";
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
import { makeEpubReader } from "../../logic/reader/epubReader.ts";

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
  setFontSize(percent: number): void;
  setColors(colors: EpubColors): void;
  clearSelection(): void;
  /** Paint the given highlights and erase every other painted one. epub.js
   *  annotations are keyed by CFI, so the session keeps its own id-to-CFI map
   *  rather than asking the rendition what it has drawn. */
  syncHighlights(highlights: readonly PaintedHighlight[]): void;
  /** The one search match the reader is standing on, painted in its own class
   *  so it survives independently of committed highlights. */
  setSearchHighlight(cfi: string | null): void;
  /** Relayout in place. A remount would reload the book and lose the reader's
   *  place, so a spread change redisplays the current CFI and repaints the
   *  annotations the relayout dropped. */
  setSpread(spread: EpubSpread): Promise<void>;
  /** Measure the whole book at the current viewport and zoom. Resolves false
   *  when a newer measurement superseded this one. */
  measurePagination(isCancelled: () => boolean): Promise<boolean>;
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
  element: Element;
  spread: EpubSpread;
  fontSizePercent: number;
  colors: EpubColors;
  onHighlightClick: (id: string) => void;
}

// Constructing a session must be synchronous: the Mount registers teardown
// before it awaits the book bytes, so a load that fails or is interrupted still
// destroys the rendition it already created.
export type EpubEngine = (options: EpubSessionOptions) => EpubSession;

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

export const HIGHLIGHT_CLASS = "bc-highlight";
export const SEARCH_HIGHLIGHT_CLASS = "bc-search";

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

export const epubJsEngine: EpubEngine = ({
  element,
  spread,
  fontSizePercent,
  colors,
  onHighlightClick,
}) => {
  const book = ePub();
  const rendition = book.renderTo(element, {
    width: "100%",
    height: "100%",
    flow: "paginated",
    spread,
  });
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
  const bridgedDocuments = new Set<Document>();
  const bridgeContent = (content: Contents) => {
    // Listen on the iframe document itself: no event from this browsing context
    // can bubble to the application's document-level Foldkit Subscriptions.
    content.document.addEventListener("keydown", forwardKey);
    content.document.addEventListener("mousedown", forwardPress, { passive: true });
    content.document.addEventListener("touchstart", forwardPress, { passive: true });
    bridgedDocuments.add(content.document);
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
  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          // A resize notification can already be queued when disconnect runs.
          // epub.js drops its manager during teardown, so that stale callback
          // must not resize the dead rendition.
          if (destroyed) return;
          const width = element.clientWidth;
          const height = element.clientHeight;
          if (width > 0 && height > 0) rendition.resize(width, height);
        })
      : null;
  resizeObserver?.observe(element);
  const drawn = new Map<string, string>();
  let searchCfi: string | null = null;
  let pagination: EpubPagination | null = null;
  let currentSpread: EpubSpread = spread;
  let currentFontSize = fontSizePercent;
  applyEpubTheme(rendition, colors);
  rendition.themes.fontSize(`${fontSizePercent}%`);

  // SAFETY: bound because epub.js reads `this.displaying` inside `display`, and
  // its public declaration accepts the same optional string target.
  const display = rendition.display.bind(rendition) as (target?: string) => Promise<void>;

  let opening: Promise<unknown> | null = null;
  let ready: Promise<void> | null = null;

  return {
    book,
    async load(bytes, initialCfi) {
      const loading = (async () => {
        opening = book.open(bytes, "binary");
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
            return metadata?.title?.trim() || null;
          } catch {
            continue;
          }
        }
        throw new Error("No displayable section found in epub");
      })();
      ready = loading.then(() => {});
      return await loading;
    },
    place: () => readPlace(rendition, pagination),
    selection: () => readSelection(rendition),
    onMoved(handler) {
      rendition.on("relocated", handler);
      return () => rendition.off("relocated", handler);
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
    setFontSize(percent) {
      currentFontSize = percent;
      rendition.themes.fontSize(`${percent}%`);
    },
    setColors(next) {
      applyEpubTheme(rendition, next);
    },
    clearSelection: () => clearContentSelections(rendition),
    syncHighlights(highlights) {
      const wanted = new Map(highlights.map((highlight) => [highlight.id, highlight.cfi]));
      for (const [id, cfi] of drawn) {
        if (wanted.get(id) === cfi) continue;
        rendition.annotations.remove(cfi, "highlight");
        drawn.delete(id);
      }
      for (const [id, cfi] of wanted) {
        if (drawn.has(id)) continue;
        rendition.annotations.highlight(cfi, { id }, () => onHighlightClick(id), HIGHLIGHT_CLASS);
        drawn.set(id, cfi);
      }
    },
    setSearchHighlight(cfi) {
      if (searchCfi !== null && searchCfi !== cfi) {
        rendition.annotations.remove(searchCfi, "highlight");
        // Removing by CFI takes the committed annotation with it when both sit
        // on the same passage, so that one is drawn again.
        const committed = [...drawn].find(([, drawnCfi]) => drawnCfi === searchCfi);
        if (committed) {
          const [id, drawnCfi] = committed;
          rendition.annotations.highlight(
            drawnCfi,
            { id },
            () => onHighlightClick(id),
            HIGHLIGHT_CLASS,
          );
        }
      }
      searchCfi = cfi;
      if (cfi !== null) {
        rendition.annotations.highlight(cfi, {}, () => {}, SEARCH_HIGHLIGHT_CLASS);
      }
    },
    async setSpread(next) {
      if (next === currentSpread) return;
      rendition.spread(next);
      const place = readPlace(rendition, pagination);
      if (place?.cfi) await display(place.cfi);
      // The relayout rebuilds the content documents, so every annotation the
      // rendition had drawn is gone with them.
      const painted = [...drawn].map(([id, cfi]) => ({ id, cfi }));
      drawn.clear();
      const search = searchCfi;
      searchCfi = null;
      this.syncHighlights(painted);
      this.setSearchHighlight(search);
      // A failed redisplay must remain retryable: the model already records
      // the requested layout, so only commit the imperative state once the
      // replacement content and its annotations are ready.
      currentSpread = next;
    },
    async measurePagination(isCancelled) {
      const measured = await measureEpubPagination(
        book,
        element.clientWidth,
        element.clientHeight,
        currentFontSize,
        currentSpread,
        isCancelled,
      );
      if (measured === null || isCancelled()) return false;
      pagination = measured;
      return true;
    },
    destroy() {
      destroyed = true;
      rendition.hooks.content.deregister(bridgeContent);
      for (const document of bridgedDocuments) {
        document.removeEventListener("keydown", forwardKey);
        document.removeEventListener("mousedown", forwardPress);
        document.removeEventListener("touchstart", forwardPress);
      }
      bridgedDocuments.clear();
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

// Effect wraps a rejected promise, so the message a reader can act on is the
// original rejection rather than the wrapper's own text.
function failureMessage(error: unknown): string {
  // SAFETY: reading an optional property off an unknown value is a presence check, not a claim.
  const cause: unknown = (error as { cause?: unknown } | null)?.cause;
  if (cause instanceof Error) return cause.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

// One EPUB adapter instance: a Mount that owns the live Book, Rendition, iframes
// and listeners for whichever source is currently displayed, plus the Commands
// surface (navigation, zoom, search) that acts on that live session. The Model
// keeps none of it — the Mount publishes domain Messages instead.
export function makeEpubMount({ loadSource, engine = epubJsEngine }: EpubMountOptions) {
  let live: EpubSession | null = null;
  let measureSeq = 0;
  let requestedSpread: EpubSpread | null = null;
  let spreadSession: EpubSession | null = null;
  let spreadTask: Promise<void> | null = null;

  const applyRequestedSpread = (session: EpubSession): Promise<void> => {
    if (spreadTask !== null && spreadSession === session) return spreadTask;
    spreadSession = session;
    const applyLatest = async (): Promise<void> => {
      if (live !== session || requestedSpread === null) return;
      const next = requestedSpread;
      await session.setSpread(next);
      if (requestedSpread !== next) await applyLatest();
    };
    const task = applyLatest();
    spreadTask = task.finally(() => {
      if (spreadSession === session) {
        spreadSession = null;
        spreadTask = null;
      }
    });
    return spreadTask;
  };

  const onLiveSession = <A>(fallback: A, use: (session: EpubSession) => Promise<A>) =>
    Effect.suspend(() => {
      const session = live;
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
      fontSizePercent: Schema.Number,
      colors: Schema.Struct({
        background: Schema.String,
        text: Schema.String,
        link: Schema.String,
      }),
    },
    OpenedEpub,
    MovedEpub,
    SelectedEpubText,
    ClearedEpubSelection,
    ClickedEpubHighlight,
    FailedEpubLoad,
  )(
    ({ sourceId, groupRef, initialCfi, spread, fontSizePercent, colors }) =>
      (element) =>
        Stream.callback<EpubMountMessage>((queue) =>
          Effect.gen(function* () {
            const emit = (message: EpubMountMessage) => {
              Queue.offerUnsafe(queue, message);
            };

            const session = yield* Effect.acquireRelease(
              Effect.sync(() => {
                requestedSpread = spread;
                const created = engine({
                  element,
                  spread,
                  fontSizePercent,
                  colors,
                  onHighlightClick: (highlightId) =>
                    emit(ClickedEpubHighlight({ sourceId, highlightId })),
                });
                live = created;
                return created;
              }),
              (created) =>
                Effect.sync(() => {
                  if (live === created) live = null;
                  created.destroy();
                }),
            );

            yield* Effect.acquireRelease(
              Effect.sync(() =>
                session.onMoved(() => {
                  const place = session.place();
                  if (place) emit(MovedEpub({ sourceId, place }));
                }),
              ),
              (unsubscribe) => Effect.sync(unsubscribe),
            );

            const opened = yield* Effect.tryPromise({
              try: () =>
                loadSource(sourceId, groupRef).then((bytes) => session.load(bytes, initialCfi)),
              // Keep the rejection itself, so what the reader is told is what
              // actually went wrong with the book.
              catch: (cause) => cause,
            }).pipe(
              Effect.map((title) => ({ title })),
              Effect.tapError((error) =>
                Effect.sync(() =>
                  emit(FailedEpubLoad({ sourceId, message: failureMessage(error) })),
                ),
              ),
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

  const reader: SourceReader = makeEpubReader(() => live?.book ?? null);

  return {
    Mount: EpubSource,
    reader,
    turnPage: (direction: "next" | "previous") =>
      onLiveSession(undefined, (session) => session.turnPage(direction)),
    goTo: (anchor: HighlightAnchor) =>
      anchor.kind === "epub-cfi"
        ? onLiveSession(undefined, (session) => session.goTo(anchor.value))
        : Effect.void,
    setFontSize: (percent: number) =>
      Effect.sync(() => {
        live?.setFontSize(percent);
      }),
    setColors: (colors: EpubColors) =>
      Effect.sync(() => {
        live?.setColors(colors);
      }),
    dismissSelection: Effect.sync(() => {
      live?.clearSelection();
    }),
    syncHighlights: (highlights: readonly PaintedHighlight[]) =>
      Effect.sync(() => {
        live?.syncHighlights(highlights);
      }),
    setSearchHighlight: (anchor: HighlightAnchor | null) =>
      Effect.sync(() => {
        live?.setSearchHighlight(anchor?.kind === "epub-cfi" ? anchor.value : null);
      }),
    setSpread: (spread: EpubSpread) =>
      Effect.tryPromise({
        try: async () => {
          requestedSpread = spread;
          const session = live;
          if (session !== null) await applyRequestedSpread(session);
        },
        catch: (cause) => cause,
      }),
    /** Measurement is expensive and viewport-dependent, so a newer request
     *  cancels the one in flight rather than queueing behind it. */
    measurePagination: Effect.suspend(() => {
      const session = live;
      if (session === null) return Effect.succeed(null);
      const seq = ++measureSeq;
      return Effect.tryPromise(() => session.measurePagination(() => seq !== measureSeq)).pipe(
        Effect.map((measured) => (measured ? session.place() : null)),
        Effect.orElseSucceed(() => null),
      );
    }),
  };
}

export type EpubMountAdapter = ReturnType<typeof makeEpubMount>;
