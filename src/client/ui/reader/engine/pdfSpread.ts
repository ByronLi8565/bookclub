import type { PdfPageLayout } from "../../../logic/settings/userPrefs.ts";
import { clamp } from "../../../../shared/format.ts";

export const SPREAD_GUTTER_PX = 4;
export const MIN_SPREAD_PANE_WIDTH = 440;

// A spread is only worth showing when the user opted in ("auto"), the document
// has at least two pages, and the viewport is wide enough that each page still
// clears the comfortable minimum width.
export function spreadFits(
  layout: PdfPageLayout,
  numPages: number,
  viewportWidth: number,
): boolean {
  if (layout !== "auto" || numPages < 2) return false;
  const perPane = (viewportWidth - SPREAD_GUTTER_PX) / 2;
  return perPane >= MIN_SPREAD_PANE_WIDTH;
}

// The left page of the spread containing `page`. With a spread the cover (page
// 1) stands alone, then pages pair up as (2,3), (4,5), … — so the left page of
// any spread is even (or the cover).
export function spreadStart(page: number, enabled: boolean): number {
  const p = Math.max(1, page);
  if (!enabled || p <= 1) return Math.max(1, p);
  return p % 2 === 0 ? p : p - 1;
}

// The 1–2 page numbers shown in the spread whose left page is `left`. The cover
// and a trailing odd page each stand alone.
export function spreadPages(left: number, enabled: boolean, numPages: number): number[] {
  if (!enabled || left <= 1 || left + 1 > numPages) return [left];
  return [left, left + 1];
}

// The right-most page in the spread starting at `left` (== left when solo).
export function spreadEnd(left: number, enabled: boolean, numPages: number): number {
  const pages = spreadPages(left, enabled, numPages);
  return pages.at(-1) ?? left;
}

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The CSS-px crop rectangle (within a full page of size pageW × pageH) that
// trims a spread page down to its text. `horizontal` is the page's own text
// x-bounds (page fractions); `vertical` is the shared y-bounds across the
// spread so both pages stay aligned. A null bound means "don't crop that axis"
// (e.g. a scanned page with no text geometry), keeping the full extent. `pad`
// is the breathing room (px) left around the text on each cropped side.
export function cropBox(
  horizontal: { minX: number; maxX: number } | null,
  vertical: { minY: number; maxY: number } | null,
  pageW: number,
  pageH: number,
  pad: number,
): CropBox {
  const left = horizontal ? clamp(horizontal.minX * pageW - pad, 0, pageW) : 0;
  const right = horizontal ? clamp(horizontal.maxX * pageW + pad, 0, pageW) : pageW;
  const top = vertical ? clamp(vertical.minY * pageH - pad, 0, pageH) : 0;
  const bottom = vertical ? clamp(vertical.maxY * pageH + pad, 0, pageH) : pageH;
  return { left, top, width: right - left, height: bottom - top };
}
