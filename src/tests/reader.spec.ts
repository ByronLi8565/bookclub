import { actions, always, extract, weighted } from "@antithesishq/bombadil";
// All default properties (bug-catchers), but only single-page actions — no
// Reload/back/forward, which just blank this SPA and dead-end exploration.
export * from "@antithesishq/bombadil/defaults/properties";
export { clicks, scroll, waitOnce } from "@antithesishq/bombadil/defaults/actions";

// Center point of an element matching `selector`, or null if absent/hidden.
const centerOf = (state: { document: Document }, selector: string) => {
  const el = state.document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
};

// Current page / total, parsed from the reader bar's .page-count.
const page = extract((state) => {
  const text = state.document.querySelector(".page-count")?.textContent ?? "";
  const m = text.match(/(\d+)\s*\/\s*(\d+)/u);
  return m ? { page: Number(m[1]), total: Number(m[2]) } : null;
});

const nextPoint = extract((state) => centerOf(state, ".reader-page-turn--next:not([disabled])"));
const prevPoint = extract((state) => centerOf(state, ".reader-page-turn--prev:not([disabled])"));

const pageNext = actions(() => {
  const p = nextPoint.current;
  return p ? [{ Click: { name: "next", point: p } }] : [];
});

const pagePrev = actions(() => {
  const p = prevPoint.current;
  return p ? [{ Click: { name: "prev", point: p } }] : [];
});

// Drive forward mostly, occasionally back.
export const paging = weighted([
  [8, pageNext],
  [1, pagePrev],
]);

// The reported page must stay within bounds.
export const pageInBounds = always(() => {
  const p = page.current;
  return p === null || (p.page >= 1 && p.page <= p.total);
});

// --- Full-text search (ctrl+f) -------------------------------------------------

// The search bar's live state: whether it's open, its input value and focus
// point, and the parsed "active / total" count (null while a scan is in flight,
// i.e. the bar shows "…").
const search = extract((state) => {
  const input = state.document.querySelector<HTMLInputElement>(".reader-search-input");
  const countText = state.document.querySelector(".reader-search-count")?.textContent ?? "";
  const m = countText.match(/(\d+)\s*\/\s*(\d+)/u);
  return {
    open: input !== null,
    value: input?.value ?? "",
    point: centerOf(state, ".reader-search-input"),
    active: m ? Number(m[1]) : null,
    total: m ? Number(m[2]) : null,
  };
});

const openSearchPoint = extract((state) => centerOf(state, ".harness-open-search:not([disabled])"));
const matchNextPoint = extract((state) =>
  centerOf(state, '.reader-search button[aria-label="Next match"]:not([disabled])'),
);

// Open the search bar when it's closed.
const openSearch = actions(() => {
  const p = openSearchPoint.current;
  return search.current?.open ? [] : p ? [{ Click: { name: "open-search", point: p } }] : [];
});

// Type a word that appears in any substantial English book. Only fires into an
// empty box, so the resulting value is exactly "the" — which the property below
// then asserts must produce matches (this is the regression guard for the bug
// where every scan silently returned zero results).
const typeKnownWord = actions(() => {
  const s = search.current;
  if (!s || !s.open || s.value !== "" || !s.point) return [];
  return [
    { Click: { name: "focus-search", point: s.point } },
    { TypeText: { text: "the", delayMillis: 20 } },
  ];
});

// Cycle to the next match.
const nextMatch = actions(() => {
  const p = matchNextPoint.current;
  return p ? [{ Click: { name: "next-match", point: p } }] : [];
});

export const searching = weighted([
  [2, openSearch],
  [3, typeKnownWord],
  [2, nextMatch],
]);

// Searching the fixture for a ubiquitous word must find at least one match. With
// the scan settled (count is a number, not "…") and the query exactly "the",
// a zero total means the book scan is broken.
export const knownWordHasMatches = always(() => {
  const s = search.current;
  if (!s || s.total === null || s.value.trim().toLowerCase() !== "the") return true;
  return s.total >= 1;
});

// The active match index is always within bounds: 1..total, or 0/0 when empty.
export const searchIndexInBounds = always(() => {
  const s = search.current;
  if (!s || s.active === null || s.total === null) return true;
  return s.total === 0 ? s.active === 0 : s.active >= 1 && s.active <= s.total;
});
