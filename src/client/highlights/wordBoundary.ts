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
