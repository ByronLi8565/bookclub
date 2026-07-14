import * as Effect from "effect/Effect";
import type { Book } from "epubjs";
import type Section from "epubjs/types/section";
import {
  epubAnchor,
  findAllRanges,
  searchQuote,
  type Highlight,
  type HighlightAnchor,
  type SourceReader,
} from "../../../logic/notes/highlights.ts";

// One loaded spine item, presented to a per-section scan.
interface SectionHandle {
  document: Document;
  cfiFromRange(range: Range): string | null;
}

// Build the note/search reader over a live epub.js Book. `getBook` is consulted
// lazily on every call so the reader can be created once yet always act on the
// currently-open book (or no-op when none is loaded).
export function makeEpubReader(getBook: () => Book | null): SourceReader {
  const withBook = Effect.fn("EpubReader.withBook")(function* <A>(
    fallback: A,
    use: (book: Book) => Effect.Effect<A>,
  ) {
    const book = getBook();
    return book ? yield* use(book) : fallback;
  });

  const findInSections = Effect.fn("EpubReader.findInSections")(function* <A>(
    pick: (section: SectionHandle) => A[],
  ) {
    return yield* withBook<A[]>([], (book) =>
      Effect.gen(function* () {
        const sections: Section[] = [];
        book.spine.each((section: Section) => sections.push(section));
        const results: A[] = [];
        for (const spineSection of sections) {
          // Isolate each section: a spine item that fails to load (cover, nav, a
          // malformed doc) is skipped rather than aborting the whole scan.
          const found = yield* Effect.acquireUseRelease(
            Effect.tryPromise(async () => {
              // `load` resolves with `contents` (the <html> element), but sets
              // `section.document` to the parsed Document as a side effect —
              // that's what we need so `doc.body` (and its text) is reachable.
              await spineSection.load(book.load.bind(book));
              return { section: spineSection, document: spineSection.document };
            }),
            ({ section, document }) =>
              Effect.sync(() =>
                pick({ document, cfiFromRange: (r) => section.cfiFromRange(r) ?? null }),
              ),
            ({ section }) => Effect.sync(() => section.unload()),
          ).pipe(Effect.orElseSucceed((): A[] => []));
          results.push(...found);
        }
        return results;
      }),
    );
  });

  const locateHighlight = Effect.fn("EpubReader.locateHighlight")(function* (h: Highlight) {
    return yield* withBook<HighlightAnchor | null>(null, (book) =>
      Effect.gen(function* () {
        if (h.anchor.kind === "epub-cfi") {
          const cfi = h.anchor.value;
          const range = yield* Effect.tryPromise(() => book.getRange(cfi)).pipe(
            Effect.map((value) => value ?? null),
            Effect.orElseSucceed(() => null),
          );
          if (range) return epubAnchor(cfi);
        }
        const fresh = yield* findInSections((section) => {
          const found = searchQuote(section.document, h.quote);
          const cfi = found ? section.cfiFromRange(found) : null;
          return cfi ? [cfi] : [];
        });
        const first = fresh[0];
        return first ? epubAnchor(first) : null;
      }),
    );
  });

  const search = Effect.fn("EpubReader.search")(function* (query: string) {
    if (query.trim() === "") return [];
    return yield* findInSections((section) =>
      findAllRanges(section.document, query).flatMap(({ range, excerpt }) => {
        const cfi = section.cfiFromRange(range);
        return cfi ? [{ anchor: epubAnchor(cfi), excerpt }] : [];
      }),
    );
  });

  return { locateHighlight, search };
}
