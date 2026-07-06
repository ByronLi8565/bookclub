import { fetchSource, uploadSource, type ApiResult, type GroupSummary } from "./groupClient.ts";
import { groupUrlName } from "../../../shared/groupUrls.ts";
import { getCachedSource, putCachedSource } from "./sourceCache.ts";
import { sourceById, sourceRefById } from "../../../shared/sources.ts";
import type { SourceHealth } from "../../../shared/types/sourceHealth.ts";
import { sourceKindFor, type SourceSummary } from "../../../shared/types/sources.ts";

export { books, currentSource } from "../../../shared/sources.ts";

export interface LoadedSource {
  source: SourceSummary;
  file: File;
  fromCache: boolean;
}

function summaryFor(group: GroupSummary, sourceId: string, file: File): SourceSummary {
  const known = sourceById(group, sourceId);
  if (known) return known;
  return {
    id: sourceId,
    kind: sourceKindFor(file.type, file.name) ?? "epub",
    contentType: file.type,
    size: file.size,
    title: group.bookTitles[sourceId] ?? null,
  };
}

export async function loadSource(
  group: GroupSummary,
  sourceId: string,
): Promise<LoadedSource | null> {
  const ref = sourceRefById(group, sourceId);
  if (!ref) return null;

  const cached = await getCachedSource(ref.id);
  if (cached) return { source: summaryFor(group, ref.id, cached), file: cached, fromCache: true };

  const fetched = await fetchSource(groupUrlName(group), ref.id);
  if (!fetched) return null;
  const id = fetched.sourceId ?? ref.id;
  void putCachedSource(id, fetched.file);
  return { source: summaryFor(group, id, fetched.file), file: fetched.file, fromCache: false };
}

export async function uploadCurrentSource(
  group: GroupSummary,
  file: File,
  health: SourceHealth,
  title: string | null,
  author: string | null,
): Promise<ApiResult<LoadedSource>> {
  const uploaded = await uploadSource(groupUrlName(group), file, health, title, author);
  if (!uploaded.ok) return uploaded;
  await putCachedSource(uploaded.value, file);
  return {
    ok: true,
    value: { source: summaryFor(group, uploaded.value, file), file, fromCache: true },
  };
}

export async function cachedSourceSize(sourceId: string): Promise<number | null> {
  return (await getCachedSource(sourceId))?.size ?? null;
}

function triggerBrowserDownload(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// Saves the book to the user's device as a normal browser download, reusing the
// cached copy when present and otherwise fetching it from storage.
export async function downloadSourceCopy(
  groupRef: string,
  sourceId: string,
): Promise<ApiResult<{ name: string }>> {
  const cached = await getCachedSource(sourceId);
  const file = cached ?? (await fetchSource(groupRef, sourceId))?.file ?? null;
  if (!file) return { ok: false, error: "no_source" };
  triggerBrowserDownload(file);
  return { ok: true, value: { name: file.name } };
}
