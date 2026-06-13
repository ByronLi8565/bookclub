import { actions, always, extract, weighted } from "@antithesishq/bombadil";
// All default properties (bug-catchers), but only single-page actions — no
// Reload/back/forward, which just blank this SPA and dead-end exploration.
export * from "@antithesishq/bombadil/defaults/properties";
export { clicks, scroll, waitOnce } from "@antithesishq/bombadil/defaults/actions";

// Current page / total, parsed from the reader bar's .page-count.
const page = extract((state) => {
  const text = state.document.querySelector(".page-count")?.textContent ?? "";
  const m = text.match(/(\d+)\s*\/\s*(\d+)/u);
  return m ? { page: Number(m[1]), total: Number(m[2]) } : null;
});

// Center point of an invisible reader edge hit zone.
const pageTurnPoint = (direction: "next" | "prev") =>
  extract((state) => {
    const el = state.document.querySelector<HTMLButtonElement>(`.reader-page-turn--${direction}`);
    if (!el || el.disabled) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });

const nextPoint = pageTurnPoint("next");
const prevPoint = pageTurnPoint("prev");

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
