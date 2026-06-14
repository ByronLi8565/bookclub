import * as Effect from "effect/Effect";
import type { Highlight, QuoteSelector } from "../../shared/types/notes.ts";
import { cfiSelector } from "../../shared/types/notes.ts";

export type { CfiSelector, Highlight, QuoteSelector } from "../../shared/types/notes.ts";
export { cfiSelector } from "../../shared/types/notes.ts";

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

// Position for the "Add Note" popup, given the selection rect (in the epub
// iframe's viewport) and the iframe element's rect (in the top document). The
// point is clamped into the visible visual viewport, which on iOS can be
// offset/zoomed relative to the layout viewport, so the popup stays on-screen.
export function popupPoint(rect: DOMRect, frame: DOMRect | undefined): { x: number; y: number } {
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

// Epub.js-facing capabilities needed by locate and full-text search.
export interface SourceReader {
  resolveCfi(cfi: string): Effect.Effect<Range | null>;
  // Load every spine item in order, run `pick` against each, and concatenate the
  // results across all sections. `pick` returns zero or more values per section
  // (e.g. one cfi for a rebind, or every match for a search). The whole book is
  // always scanned — callers wanting only the first hit take results[0].
  findInSections<A>(pick: (section: SectionHandle) => A[]): Effect.Effect<A[]>;
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
      const cfi = found ? section.cfiFromRange(found) : null;
      return cfi ? [cfi] : [];
    });

    const first = fresh[0];
    return first ? { cfi: first } : null;
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

// A single full-text search hit: where it is (cfi) plus a one-line snippet of
// surrounding text for the search bar to show.
export interface SearchMatch {
  cfi: string;
  excerpt: string;
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
// that fail to resolve to a Range.
function findAllRanges(doc: Document, query: string): { range: Range; excerpt: string }[] {
  const root = doc.body;
  if (!root) return [];
  const text = root.textContent ?? "";
  return scanText(text, query).flatMap(({ start, excerpt }) => {
    const range = rangeFromOffsets(root, start, start + query.length);
    return range ? [{ range, excerpt }] : [];
  });
}

// Full-text search across the whole book: every match, in reading order, as a
// cfi + excerpt. Drives the reader's ctrl+f. Empty queries yield no matches.
export const searchSource = (reader: SourceReader, query: string): Effect.Effect<SearchMatch[]> =>
  query.trim() === ""
    ? Effect.succeed([])
    : reader.findInSections((section) =>
        findAllRanges(section.document, query).flatMap(({ range, excerpt }) => {
          const cfi = section.cfiFromRange(range);
          return cfi ? [{ cfi, excerpt }] : [];
        }),
      );
