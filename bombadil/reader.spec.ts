import { actions, always, eventually, extract, weighted } from "@antithesishq/bombadil";
// All default properties (bug-catchers), but only single-page actions — no
// Reload/back/forward, which just blank this SPA and dead-end exploration.
export * from "@antithesishq/bombadil/defaults/properties";
export { clicks, scroll, waitOnce } from "@antithesishq/bombadil/defaults/actions";

// Current page / total, parsed from the reader bar's .page-count.
const page = extract((state) => {
  const text = state.document.querySelector(".page-count")?.textContent ?? "";
  const m = text.match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { page: Number(m[1]), total: Number(m[2]) } : null;
});

// Center point of a reader-bar button whose label contains `label`.
const buttonPoint = (label: string) =>
  extract((state) => {
    const el = Array.from(
      state.document.querySelectorAll<HTMLButtonElement>(".reader-bar button"),
    ).find((b) => b.textContent?.toLowerCase().includes(label));
    if (!el || el.disabled) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });

const nextPoint = buttonPoint("next");
const prevPoint = buttonPoint("prev");

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

// The bug: paging stops after the second page. if next ever works past page 2
// This holds; if the reader gets stuck, it never holds and bombadil reports it.
export const canPagePastSecond = eventually(() => (page.current?.page ?? 0) > 2);
