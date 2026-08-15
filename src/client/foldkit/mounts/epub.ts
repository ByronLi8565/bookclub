import { Effect, Queue, Schedule, Schema, Stream } from "effect";
import ePub, { type Book, type Contents, type Rendition } from "epubjs";
import type Navigation from "epubjs/types/navigation";
import { Mount } from "foldkit";
import { m } from "foldkit/message";
import {
  expandToWordBoundaries,
  popupPoint,
  type HighlightAnchor,
  type SourceReader,
} from "../../logic/notes/highlights.ts";
import { makeEpubReader } from "../../ui/reader/engine/epubReader.ts";

export const EpubSpread = Schema.Literals(["auto", "none"]);
export type EpubSpread = typeof EpubSpread.Type;

// Where the reader sits, in the renderer's own terms. Turning this into a page
// count belongs to the pagination helpers, not to the Mount.
export const EpubPlace = Schema.Struct({
  spineIndex: Schema.Number,
  cfi: Schema.NullOr(Schema.String),
  page: Schema.Number,
  atStart: Schema.Boolean,
  atEnd: Schema.Boolean,
});
export type EpubPlace = typeof EpubPlace.Type;

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
  quote: Schema.String,
  point: EpubPoint,
});
export const ClearedEpubSelection = m("ClearedEpubSelection", { sourceId: Schema.String });
export const FailedEpubLoad = m("FailedEpubLoad", {
  sourceId: Schema.String,
  message: Schema.String,
});

export type EpubMountMessage =
  | typeof OpenedEpub.Type
  | typeof MovedEpub.Type
  | typeof SelectedEpubText.Type
  | typeof ClearedEpubSelection.Type
  | typeof FailedEpubLoad.Type;

export interface EpubSelectionReading {
  cfi: string;
  quote: string;
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
  clearSelection(): void;
  destroy(): void;
}

export interface EpubSessionOptions {
  element: Element;
  spread: EpubSpread;
  fontSizePercent: number;
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

function readPlace(rendition: Rendition): EpubPlace | null {
  const currentLocation: unknown = rendition.currentLocation();
  // SAFETY: epub.js currentLocation uses this documented location shape after display.
  const location = currentLocation as
    | {
        start?: { index: number; cfi?: string; displayed?: { page: number } };
        atStart?: boolean;
        atEnd?: boolean;
      }
    | undefined;
  const start = location?.start;
  if (!start?.displayed) return null;
  return {
    spineIndex: start.index,
    cfi: start.cfi ?? null,
    page: start.displayed.page,
    atStart: location?.atStart ?? false,
    atEnd: location?.atEnd ?? false,
  };
}

function readSelection(rendition: Rendition): EpubSelectionReading | null {
  const renditionContents: unknown = rendition.getContents();
  // SAFETY: epub.js getContents returns its Contents instances despite the incomplete declaration.
  const contents = renditionContents as Contents[];
  for (const content of contents) {
    const selection = content.window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) continue;
    const range = expandToWordBoundaries(selection.getRangeAt(0));
    const quote = range.toString();
    if (quote.trim() === "") continue;
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

export const epubJsEngine: EpubEngine = ({ element, spread, fontSizePercent }) => {
  const book = ePub();
  const rendition = book.renderTo(element, { width: "100%", height: "100%", spread });
  rendition.themes.default({ body: { "-webkit-user-select": "text", "user-select": "text" } });
  rendition.themes.fontSize(`${fontSizePercent}%`);

  // SAFETY: epub.js accepts an omitted target to display its first linear section.
  const display = rendition.display as (target?: string) => Promise<void>;

  return {
    book,
    async load(bytes, initialCfi) {
      await book.open(bytes, "binary");
      const metadata = await book.loaded.metadata.catch(() => null);
      const navigation = await book.loaded.navigation.catch(() => null);
      // Try the most specific target first: a body-matter landmark can fail to
      // resolve to a spine item, so we end at epub.js's own first-linear-section
      // behavior rather than treating that as an unopenable book.
      const candidates = [
        linearSpineTarget(book, initialCfi),
        linearSpineTarget(book, navigation ? readingStartHref(navigation) : undefined),
        undefined,
      ];
      for (const target of candidates) {
        try {
          await display(target);
          return metadata?.title?.trim() || null;
        } catch {
          continue;
        }
      }
      throw new Error("No displayable section found in epub");
    },
    place: () => readPlace(rendition),
    selection: () => readSelection(rendition),
    onMoved(handler) {
      rendition.on("relocated", handler);
      return () => rendition.off("relocated", handler);
    },
    turnPage: (direction) => (direction === "next" ? rendition.next() : rendition.prev()),
    goTo: (cfi) => display(cfi),
    setFontSize: (percent) => rendition.themes.fontSize(`${percent}%`),
    clearSelection: () => clearContentSelections(rendition),
    destroy() {
      rendition.destroy();
      book.destroy();
    },
  };
};

export interface EpubMountOptions {
  loadSource: (sourceId: string) => Promise<ArrayBuffer>;
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

  const onLiveSession = <A>(fallback: A, use: (session: EpubSession) => Promise<A>) =>
    Effect.suspend(() => {
      const session = live;
      return session === null ? Effect.succeed(fallback) : Effect.tryPromise(() => use(session));
    });

  const EpubSource = Mount.defineStream(
    "EpubSource",
    {
      sourceId: Schema.String,
      initialCfi: Schema.NullOr(Schema.String),
      spread: EpubSpread,
      fontSizePercent: Schema.Number,
    },
    OpenedEpub,
    MovedEpub,
    SelectedEpubText,
    ClearedEpubSelection,
    FailedEpubLoad,
  )(
    ({ sourceId, initialCfi, spread, fontSizePercent }) =>
      (element) =>
        Stream.callback<EpubMountMessage>((queue) =>
          Effect.gen(function* () {
            const emit = (message: EpubMountMessage) => {
              Queue.offerUnsafe(queue, message);
            };

            const session = yield* Effect.acquireRelease(
              Effect.sync(() => {
                const created = engine({ element, spread, fontSizePercent });
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

            const opened = yield* Effect.tryPromise(() =>
              loadSource(sourceId).then((bytes) => session.load(bytes, initialCfi)),
            ).pipe(
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
    dismissSelection: Effect.sync(() => {
      live?.clearSelection();
    }),
  };
}

export type EpubMountAdapter = ReturnType<typeof makeEpubMount>;
