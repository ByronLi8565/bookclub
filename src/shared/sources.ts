// The club source rules live here, behind accessors, so callers never reach into
// `group.sources` directly. A club binds a list of sources (its library); the
// "current" source is the selection default (the first bound entry). Per-source
// metadata (kind/contentType/size) lives in `sourceMeta`; legacy groups without
// metadata are interpreted as EPUB.

import type { GroupSummary } from "./types/groups.ts";
import { EPUB_CONTENT_TYPE, type SourceRef, type SourceSummary } from "./types/sources.ts";

// Build the display summary for a bound source id, applying the club's recorded
// metadata and title override (defaulting legacy entries to EPUB).
function summaryFor(group: GroupSummary, id: string): SourceSummary {
  const meta = group.sourceMeta[id];
  return {
    id,
    kind: meta?.kind ?? "epub",
    contentType: meta?.contentType ?? EPUB_CONTENT_TYPE,
    size: meta?.size ?? 0,
    // Member override wins; otherwise fall back to the parsed metadata title.
    title: group.bookTitles[id] ?? meta?.title ?? null,
  };
}

// Every source bound to the club, in bind order (the library).
export function books(group: GroupSummary): SourceSummary[] {
  return group.sources.map((id) => summaryFor(group, id));
}

// A specific bound source by id, or null if it isn't bound to this club.
export function sourceById(group: GroupSummary, id: string): SourceSummary | null {
  return group.sources.includes(id) ? summaryFor(group, id) : null;
}

export function sourceRefById(group: GroupSummary, id: string): SourceRef | null {
  const source = sourceById(group, id);
  return source ? { id: source.id, kind: source.kind, contentType: source.contentType } : null;
}

export function currentSourceId(group: GroupSummary): string | null {
  return group.sources[0] ?? null;
}

export function currentSource(group: GroupSummary): SourceSummary | null {
  const id = currentSourceId(group);
  return id ? summaryFor(group, id) : null;
}

export function currentSourceRef(group: GroupSummary): SourceRef | null {
  const source = currentSource(group);
  return source ? { id: source.id, kind: source.kind, contentType: source.contentType } : null;
}
