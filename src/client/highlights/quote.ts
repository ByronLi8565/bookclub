import type { QuoteSelector } from "./types.ts";

// How much surrounding context to capture on each side of the exact text.
const CONTEXT = 32;

// Derive a QuoteSelector (exact + prefix + suffix) from a live DOM Range.
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

// Search a document for a QuoteSelector, preferring the match whose
// Surrounding text agrees with the stored prefix/suffix. Returns a Range
// Or null if the exact text cannot be found at all.
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
