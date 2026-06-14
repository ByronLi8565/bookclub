import { fetchBook, uploadBook, type ApiResult, type GroupSummary } from "./api.ts";
import { deleteCachedBook, getCachedBook, putCachedBook } from "./bookCache.ts";

export interface GroupBookRef {
  groupName: string;
  sourceId: string;
}

export interface LoadedGroupBook {
  sourceId: string;
  file: File;
  fromCache: boolean;
}

// The current-book rule for v1: a group has at most one selected book, stored as
// the first bound source. Multi-book selection should change this seam, not every
// caller that needs bytes.
export function currentBookRef(group: GroupSummary): GroupBookRef | null {
  const sourceId = group.sources[0];
  return sourceId ? { groupName: group.name, sourceId } : null;
}

// Load the group's current book, preferring the local IndexedDB copy and falling
// back to the worker/R2 route on a miss. Successful network fetches seed cache.
export async function loadCurrentGroupBook(group: GroupSummary): Promise<LoadedGroupBook | null> {
  const ref = currentBookRef(group);
  if (!ref) return null;

  const cached = await getCachedBook(ref.sourceId);
  if (cached) return { sourceId: ref.sourceId, file: cached, fromCache: true };

  const fetched = await fetchBook(ref.groupName);
  if (!fetched) return null;
  const sourceId = fetched.sourceId ?? ref.sourceId;
  void putCachedBook(sourceId, fetched.file);
  return { sourceId, file: fetched.file, fromCache: false };
}

// Upload a new group book and seed the cache with the same bytes, so the next
// group load can open locally without immediately re-fetching from R2.
export async function uploadCurrentGroupBook(
  groupName: string,
  file: File,
): Promise<ApiResult<LoadedGroupBook>> {
  const uploaded = await uploadBook(groupName, file);
  if (!uploaded.ok) return uploaded;
  await putCachedBook(uploaded.value, file);
  return { ok: true, value: { sourceId: uploaded.value, file, fromCache: true } };
}

export async function cachedBookSize(sourceId: string): Promise<number | null> {
  return (await getCachedBook(sourceId))?.size ?? null;
}

// Refresh the local copy from worker/R2. Deleting first ensures a failed fetch
// does not leave callers believing the old cached bytes were refreshed.
export async function refreshGroupBook(ref: GroupBookRef): Promise<ApiResult<LoadedGroupBook>> {
  await deleteCachedBook(ref.sourceId);
  const fetched = await fetchBook(ref.groupName);
  if (!fetched) return { ok: false, error: "no_book" };
  const sourceId = fetched.sourceId ?? ref.sourceId;
  await putCachedBook(sourceId, fetched.file);
  return { ok: true, value: { sourceId, file: fetched.file, fromCache: true } };
}
