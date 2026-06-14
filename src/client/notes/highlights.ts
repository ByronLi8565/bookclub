import * as Effect from "effect/Effect";
import type { Highlight, HighlightAnchor, QuoteSelector } from "../../shared/types/notes.ts";

export type {
  Highlight,
  HighlightAnchor,
  PdfRect,
  QuoteSelector,
} from "../../shared/types/notes.ts";
export { epubAnchor, pdfAnchor } from "../../shared/types/notes.ts";

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

// Position for the "Add Note" popup, given the selection rect (in the reader
// surface's viewport) and the frame element's rect (in the top document, for an
// epub iframe; undefined when the text layer is in the top document). The point
// is clamped into the visible visual viewport, which on iOS can be
// offset/zoomed relative to the layout viewport, so the popup stays on-screen.
export function popupPoint(rect: DOMRect, frame?: DOMRect): { x: number; y: number } {
  const vv = window.visualViewport;
  const ox = vv?.offsetLeft ?? 0;
  const oy = vv?.offsetTop ?? 0;
  const m = 48;
  const x = (frame?.left ?? 0) + rect.left + rect.width / 2;
  const y = (frame?.top ?? 0) + rect.bottom;
  return {
    x: Math.min(ox + (vv?.width ?? window.innerWidth) - m, Math.max(ox + m, x)),
    y: Math.min(oy + (vv?.height ?? window.innerHeight) - m, Math.max(oy + m, y)),
  };
}

// How much surrounding context to capture on each side of the exact text.
const CONTEXT = 32;

// Derive a QuoteSelector (exact + prefix + suffix) from a live DOM Range. Shared
// by both reader adapters: epub spine documents and pdf text-layer documents are
// both DOM, so the same context extraction applies.
export function deriveQuote(range: Range): QuoteSelector {
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

// Turn a selection (a kind-specific anchor + the live range) into a Highlight.
// The id is a local placeholder; the server assigns the canonical ulid later.
export const captureHighlight = (
  sourceId: string,
  anchor: HighlightAnchor,
  range: Range,
): Effect.Effect<Highlight> =>
  Effect.sync(() => ({
    id: crypto.randomUUID(),
    sourceId,
    anchor,
    quote: deriveQuote(range),
    createdAt: new Date().toISOString(),
  }));

// One full-text search hit: its anchor plus a one-line snippet of surrounding
// text for the search bar to show.
export interface SearchMatch {
  anchor: HighlightAnchor;
  excerpt: string;
}

// The reader's anchor-oriented capabilities, implemented by each source adapter
// (EPUB, PDF). Locating and searching are adapter-owned: the reconciler and the
// search bar depend only on this narrow seam, never on cfi or page specifics.
export interface SourceReader {
  // Resolve a highlight's anchor, rebinding via its quote fallback if the stored
  // anchor no longer resolves. Null when it cannot be located at all.
  locateHighlight(highlight: Highlight): Effect.Effect<HighlightAnchor | null>;
  // Full-text search across the whole source, in reading order.
  search(query: string): Effect.Effect<SearchMatch[]>;
}

// Search a document for a QuoteSelector, preferring the match whose surrounding
// text agrees with the stored prefix/suffix. Returns a Range or null if the
// exact text cannot be found at all. Shared by both adapters' rebind paths.
export function searchQuote(doc: Document, quote: QuoteSelector): Range | null {
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
export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
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

// How much context to show on each side of a match in the excerpt.
const EXCERPT = 40;

// One occurrence of a query within a plain text string: its start offset and a
// trimmed, single-line excerpt of the surrounding context.
export interface TextMatch {
  start: number;
  excerpt: string;
}

// Find every (case-insensitive) occurrence of `query` in `text`. Non-overlapping:
// each scan resumes past the previous hit. Pure (no DOM), so it's unit-testable.
export function scanText(text: string, query: string): TextMatch[] {
  if (query === "") return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  const matches: TextMatch[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    const end = at + query.length;
    const excerpt = `${text.slice(Math.max(0, at - EXCERPT), end + EXCERPT)}`
      .replaceAll(/\s+/gu, " ")
      .trim();
    matches.push({ start: at, excerpt });
    from = end;
  }
  return matches;
}

// Map the pure string matches back to DOM Ranges within a document, dropping any
// that fail to resolve to a Range. Shared by both adapters' full-text search.
export function findAllRanges(doc: Document, query: string): { range: Range; excerpt: string }[] {
  const root = doc.body;
  if (!root) return [];
  const text = root.textContent ?? "";
  return scanText(text, query).flatMap(({ start, excerpt }) => {
    const range = rangeFromOffsets(root, start, start + query.length);
    return range ? [{ range, excerpt }] : [];
  });
}
