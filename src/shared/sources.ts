import type { GroupSummary } from "./types/groups.ts";
import { EPUB_CONTENT_TYPE, type SourceRef, type SourceSummary } from "./types/sources.ts";

function summaryFor(group: GroupSummary, id: string): SourceSummary {
  const meta = group.sourceMeta[id];
  return {
    id,
    kind: meta?.kind ?? "epub",
    contentType: meta?.contentType ?? EPUB_CONTENT_TYPE,
    size: meta?.size ?? 0,
    title: group.bookTitles[id] ?? meta?.title ?? null,
  };
}

export function books(group: GroupSummary): SourceSummary[] {
  return group.sources.map((id) => summaryFor(group, id));
}

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
