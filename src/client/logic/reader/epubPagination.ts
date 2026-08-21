import type { Book } from "epubjs";

/** The book measured as arrow-key presses to the end. `offsetByIndex` maps a
 *  spine index to the number of presses that precede that section. */
export interface EpubPagination {
  total: number;
  divisor: number;
  offsetByIndex: Map<number, number>;
}

/** Where the reader sits in the renderer's own terms, before it becomes a
 *  press count. */
export interface EpubPlacement {
  spineIndex: number;
  page: number;
}

export interface EpubPageCount {
  page: number;
  total: number;
  percentage: number;
}

/**
 * Count the page-turns (arrow presses) for the whole book at a given viewport
 * and zoom, by laying every section out in a hidden, throwaway rendition over
 * the *same* already-parsed book and reading the real per-section page count.
 * One press advances by `layout.delta`; with a 2-up spread `divisor` is 2.
 *
 * Renderer-independent in the sense that matters here: it needs an open epub.js
 * Book but not the reader's own rendition, so both the React reader and the
 * Foldkit EPUB Mount measure the same way.
 */
export async function measureEpubPagination(
  book: Book,
  width: number,
  height: number,
  fontSizePct: number,
  spread: string,
  isCancelled: () => boolean,
): Promise<EpubPagination | null> {
  if (width <= 0 || height <= 0) return null;

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:${height}px;visibility:hidden;pointer-events:none;`;
  document.body.appendChild(host);

  const probe = book.renderTo(host, { width, height, spread, flow: "paginated" });
  probe.themes.fontSize(`${fontSizePct}%`);
  try {
    const bookSpine: unknown = book.spine;
    // SAFETY: epub.js populates spineItems after the book has opened, but its published type omits it.
    const items = (bookSpine as { spineItems: { index: number; href: string; linear?: string }[] })
      .spineItems;

    const offsetByIndex = new Map<number, number>();
    let total = 0;
    let divisor = 1;
    for (const item of items) {
      if (isCancelled()) return null;
      offsetByIndex.set(item.index, total);
      if (item.linear === "no") continue;
      await probe.display(item.href);
      if (isCancelled()) return null;
      const currentLocation: unknown = probe.currentLocation();
      // SAFETY: epub.js currentLocation uses this documented location shape when a section is displayed.
      const loc = currentLocation as { start?: { displayed?: { total?: number } } } | undefined;
      const renditionProbe: unknown = probe;
      // SAFETY: epub.js stores the active layout divisor on its internal rendition manager.
      const props = (renditionProbe as { manager?: { layout?: { props?: { divisor?: number } } } })
        .manager?.layout?.props;
      if (props?.divisor) divisor = props.divisor;
      const pages = loc?.start?.displayed?.total ?? 1;
      total += Math.max(1, Math.ceil(pages / divisor));
    }
    return { total, divisor, offsetByIndex };
  } finally {
    probe.destroy();
    host.remove();
  }
}

/** Turn a raw placement into a press count. Before pagination lands the count
 *  is zero, which readers show as "no page count yet" rather than page one. */
export function epubPageCount(
  pagination: EpubPagination | null,
  placement: EpubPlacement,
): EpubPageCount {
  if (!pagination || pagination.total <= 0) return { page: 0, total: 0, percentage: 0 };
  const before = pagination.offsetByIndex.get(placement.spineIndex) ?? 0;
  const within = Math.max(1, Math.ceil(placement.page / pagination.divisor));
  const page = Math.min(pagination.total, before + within);
  return { page, total: pagination.total, percentage: page / pagination.total };
}
