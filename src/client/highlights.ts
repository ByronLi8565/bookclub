import * as Effect from "effect/Effect";

// A Highlight is a stable reference into an immutable Source.
// It carries two selectors, following W3C Web Annotation model
//   CfiSelector:   the primary, locator (EPUB CFI).
//   QuoteSelector: the fallback, used to rebind if a CFI fails to resolve.
export interface CfiSelector {
  type: "FragmentSelector";
  conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html";
  value: string; // Epubcfi(...)
}

export interface QuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Highlight {
  id: string;
  sourceId: string; // Sha256 of the SourceFile this Highlight lives in
  cfi: CfiSelector;
  quote: QuoteSelector;
  createdAt: string; // ISO, display-only
}

export function cfiSelector(value: string): CfiSelector {
  return {
    type: "FragmentSelector",
    conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html",
    value,
  };
}

// Snap a selection out to whole words, so a sloppy drag still yields a clean
// highlight. Only text-node endpoints are adjusted; element boundaries are left
// as-is.
const WORD = /[\p{L}\p{N}_'’-]/u;

export function expandToWordBoundaries(range: Range): Range {
  const r = range.cloneRange();

  const { startContainer: sc } = r;
  if (sc.nodeType === Node.TEXT_NODE) {
    const text = sc.textContent ?? "";
    let start = r.startOffset;
    while (start > 0 && WORD.test(text[start - 1]!)) start--;
    r.setStart(sc, start);
  }

  const { endContainer: ec } = r;
  if (ec.nodeType === Node.TEXT_NODE) {
    const text = ec.textContent ?? "";
    let end = r.endOffset;
    while (end < text.length && WORD.test(text[end]!)) end++;
    r.setEnd(ec, end);
  }

  return r;
}

// How much surrounding context to capture on each side of the exact text.
const CONTEXT = 32;

// Derive a QuoteSelector (exact + prefix + suffix) from a live DOM Range.
function deriveQuote(range: Range): QuoteSelector {
  const doc = range.startContainer.ownerDocument;
  const root = doc?.body;
  if (!root) {
    return { type: "TextQuoteSelector", exact: range.toString(), prefix: "", suffix: "" };
  }

  const before = doc.createRange();
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);

  const after = doc.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(root, root.childNodes.length);

  return {
    type: "TextQuoteSelector",
    exact: range.toString(),
    prefix: before.toString().slice(-CONTEXT),
    suffix: after.toString().slice(0, CONTEXT),
  };
}

// Turn a selection (cfi + live range) into a Highlight. The id is a local
// placeholder; the server will assign the canonical ulid in a later step.
export const captureHighlight = (
  sourceId: string,
  cfi: string,
  range: Range,
): Effect.Effect<Highlight> =>
  Effect.sync(() => ({
    id: crypto.randomUUID(),
    sourceId,
    cfi: cfiSelector(cfi),
    quote: deriveQuote(range),
    createdAt: new Date().toISOString(),
  }));

// One loaded spine item, presented to the rebind search.
export interface SectionHandle {
  document: Document;
  cfiFromRange(range: Range): string | null;
}

// Epub.js-facing capabilities needed by locate.
export interface SourceReader {
  resolveCfi(cfi: string): Effect.Effect<Range | null>;
  findInSections(pick: (section: SectionHandle) => string | null): Effect.Effect<string | null>;
}

export interface HighlightLocation {
  cfi: string;
}

export const locateHighlight = (
  h: Highlight,
  reader: SourceReader,
): Effect.Effect<HighlightLocation | null> =>
  Effect.gen(function* () {
    const range = yield* reader.resolveCfi(h.cfi.value);
    if (range) return { cfi: h.cfi.value };

    const fresh = yield* reader.findInSections((section) => {
      const found = searchQuote(section.document, h.quote);
      return found ? section.cfiFromRange(found) : null;
    });

    return fresh ? { cfi: fresh } : null;
  });

// Search a document for a QuoteSelector, preferring the match whose
// surrounding text agrees with the stored prefix/suffix. Returns a Range
// or null if the exact text cannot be found at all.
function searchQuote(doc: Document, quote: QuoteSelector): Range | null {
  const root = doc.body;
  if (!root) return null;
  const text = root.textContent ?? "";

  // Prefer the precise (prefix + exact + suffix) match.
  const contextual = quote.prefix + quote.exact + quote.suffix;
  let start = text.indexOf(contextual);
  if (start >= 0) {
    start += quote.prefix.length;
  } else {
    start = text.indexOf(quote.exact);
    if (start < 0) return null;
  }
  return rangeFromOffsets(root, start, start + quote.exact.length);
}

// Map character offsets within an element's textContent back to a DOM Range.
function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = root.ownerDocument!.createRange();
  let offset = 0;
  let startSet = false;
  let node = walker.nextNode();

  while (node) {
    const len = node.textContent?.length ?? 0;
    if (!startSet && offset + len >= start) {
      range.setStart(node, start - offset);
      startSet = true;
    }
    if (startSet && offset + len >= end) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += len;
    node = walker.nextNode();
  }
  return null;
}
