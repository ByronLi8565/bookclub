import * as Effect from "effect/Effect";
import type { Highlight, HighlightAnchor, QuoteSelector } from "../../shared/types/notes.ts";

export type {
  Highlight,
  HighlightAnchor,
  PdfRect,
  QuoteSelector,
} from "../../shared/types/notes.ts";
export { epubAnchor, pdfAnchor } from "../../shared/types/notes.ts";

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

const CONTEXT = 32;

function shouldInsertBoundarySpace(text: string, next: string): boolean {
  return text.length > 0 && next.length > 0 && /\S$/u.test(text) && /^\S/u.test(next);
}

function rangeText(range: Range): string {
  const root = range.commonAncestorContainer;
  if (root.nodeType === root.TEXT_NODE) {
    return (root.textContent ?? "").slice(range.startOffset, range.endOffset);
  }

  const filter = range.startContainer.ownerDocument!.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = range.startContainer.ownerDocument!.createTreeWalker(root, filter);
  let text = "";

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;

    let str = node.textContent ?? "";
    if (node === range.startContainer) str = str.slice(range.startOffset);
    if (node === range.endContainer) str = str.slice(0, range.endOffset);
    if (str.length === 0) continue;

    if (shouldInsertBoundarySpace(text, str)) text += " ";
    text += str;
  }

  return text;
}

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

function derivePdfQuote(range: Range): QuoteSelector {
  const doc = range.startContainer.ownerDocument;
  const root = doc?.body;
  if (!root) {
    return { type: "TextQuoteSelector", exact: rangeText(range), prefix: "", suffix: "" };
  }

  const before = doc.createRange();
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);

  const after = doc.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(root, root.childNodes.length);

  return {
    type: "TextQuoteSelector",
    exact: rangeText(range),
    prefix: rangeText(before).slice(-CONTEXT),
    suffix: rangeText(after).slice(0, CONTEXT),
  };
}

export const captureHighlight = (
  sourceId: string,
  anchor: HighlightAnchor,
  range: Range,
): Effect.Effect<Highlight> =>
  Effect.sync(() => ({
    id: crypto.randomUUID(),
    sourceId,
    anchor,
    quote: anchor.kind === "pdf-text" ? derivePdfQuote(range) : deriveQuote(range),
    createdAt: new Date().toISOString(),
  }));

export interface SearchMatch {
  anchor: HighlightAnchor;
  excerpt: string;
}

export interface SourceReader {
  locateHighlight(highlight: Highlight): Effect.Effect<HighlightAnchor | null>;

  search(query: string): Effect.Effect<SearchMatch[]>;
}

export function searchQuote(doc: Document, quote: QuoteSelector): Range | null {
  const root = doc.body;
  if (!root) return null;
  const text = root.textContent ?? "";

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

const EXCERPT = 40;

export interface TextMatch {
  start: number;
  excerpt: string;
}

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

export function findAllRanges(doc: Document, query: string): { range: Range; excerpt: string }[] {
  const root = doc.body;
  if (!root) return [];
  const text = root.textContent ?? "";
  return scanText(text, query).flatMap(({ start, excerpt }) => {
    const range = rangeFromOffsets(root, start, start + query.length);
    return range ? [{ range, excerpt }] : [];
  });
}
