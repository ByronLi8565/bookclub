// The club current-source rule lives here, behind accessors, so callers never
// reach into `sources[0]` directly. v1 keeps the array shape: a club has at most
// one current source, stored as the first bound entry. Per-source metadata
// (kind/contentType/size) lives in `sourceMeta`; legacy groups without metadata
// are interpreted as EPUB.

import type { GroupSummary } from "./types/groups.ts";
import { EPUB_CONTENT_TYPE, type SourceRef, type SourceSummary } from "./types/sources.ts";

export function currentSourceId(group: GroupSummary): string | null {
  return group.sources[0] ?? null;
}

export function currentSource(group: GroupSummary): SourceSummary | null {
  const id = currentSourceId(group);
  if (!id) return null;
  const meta = group.sourceMeta[id];
  return {
    id,
    kind: meta?.kind ?? "epub",
    contentType: meta?.contentType ?? EPUB_CONTENT_TYPE,
    size: meta?.size ?? 0,
    title: group.bookTitles[id] ?? null,
  };
}

export function currentSourceRef(group: GroupSummary): SourceRef | null {
  const source = currentSource(group);
  return source ? { id: source.id, kind: source.kind, contentType: source.contentType } : null;
}
