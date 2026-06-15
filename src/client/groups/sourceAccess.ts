import { fetchSource, uploadSource, type ApiResult, type GroupSummary } from "./api.ts";
import { deleteCachedSource, getCachedSource, putCachedSource } from "./sourceCache.ts";
import { currentSourceId, sourceById, sourceRefById } from "../../shared/sources.ts";
import type { SourceHealth } from "../../shared/types/sourceHealth.ts";
import { sourceKindFor, type SourceSummary } from "../../shared/types/sources.ts";

export { books, currentSource, currentSourceRef } from "../../shared/sources.ts";

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

  const fetched = await fetchSource(group.name, ref.id);
  if (!fetched) return null;
  const id = fetched.sourceId ?? ref.id;
  void putCachedSource(id, fetched.file);
  return { source: summaryFor(group, id, fetched.file), file: fetched.file, fromCache: false };
}

export function loadCurrentSource(group: GroupSummary): Promise<LoadedSource | null> {
  const id = currentSourceId(group);
  return id ? loadSource(group, id) : Promise.resolve(null);
}

export async function uploadCurrentSource(
  group: GroupSummary,
  file: File,
  health: SourceHealth,
  title: string | null,
  author: string | null,
): Promise<ApiResult<LoadedSource>> {
  const uploaded = await uploadSource(group.name, file, health, title, author);
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

export async function refreshSource(
  groupName: string,
  sourceId: string,
): Promise<ApiResult<LoadedSource>> {
  await deleteCachedSource(sourceId);
  const fetched = await fetchSource(groupName, sourceId);
  if (!fetched) return { ok: false, error: "no_source" };
  const id = fetched.sourceId ?? sourceId;
  await putCachedSource(id, fetched.file);
  const source: SourceSummary = {
    id,
    kind: sourceKindFor(fetched.contentType) ?? "epub",
    contentType: fetched.contentType,
    size: fetched.file.size,
    title: null,
  };
  return { ok: true, value: { source, file: fetched.file, fromCache: true } };
}
