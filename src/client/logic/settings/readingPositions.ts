import * as Effect from "effect/Effect";
import type { SourceKind } from "../../../shared/types/sources.ts";
import { decode } from "../../../shared/schema.ts";
import {
  ReadingPositionCache,
  ReadingPositionResponse,
  type SourceReadingPosition,
  type ReadingPositionRecord,
  type StoredReadingPosition,
} from "../../../shared/types/readingPositions.ts";
import { readVersionedLocal, writeLocal } from "../storage.ts";
import { ApiRequestError, decodeJson, request } from "../net/request.ts";

const STORAGE_KEY = "bookclub.readingPositions:v1";
const LEGACY_STORAGE_KEY = "bookclub.readingPositions";
const syncingKeys = new Set<string>();

function positionKey(userId: string, groupId: string, sourceId: string): string {
  return `${userId}:${groupId}:${sourceId}`;
}

function samePosition(a: StoredReadingPosition | null, b: StoredReadingPosition | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function loadAll(): Record<string, ReadingPositionRecord> {
  const stored = readVersionedLocal<unknown>(STORAGE_KEY, LEGACY_STORAGE_KEY);
  return decode(ReadingPositionCache, stored) ?? {};
}

function saveAll(positions: Record<string, ReadingPositionRecord>): void {
  writeLocal(STORAGE_KEY, positions);
}

function getRecord(
  userId: string,
  groupId: string,
  sourceId: string,
): ReadingPositionRecord | null {
  return loadAll()[positionKey(userId, groupId, sourceId)] ?? null;
}

function saveRecord(
  userId: string,
  groupId: string,
  sourceId: string,
  record: ReadingPositionRecord,
): ReadingPositionRecord {
  const positions = loadAll();
  positions[positionKey(userId, groupId, sourceId)] = record;
  saveAll(positions);
  return record;
}

export function getReadingPosition(
  userId: string,
  groupId: string,
  sourceId: string,
  kind: SourceKind,
): ReadingPositionRecord | null {
  const record = getRecord(userId, groupId, sourceId);
  return record?.position.kind === kind &&
    record.position.groupId === groupId &&
    record.position.sourceId === sourceId
    ? record
    : null;
}

export function setLocalReadingPosition(
  userId: string,
  groupId: string,
  sourceId: string,
  position: SourceReadingPosition,
): ReadingPositionRecord {
  const stored = { ...position, groupId, sourceId, updatedAt: new Date().toISOString() };
  const previous = getRecord(userId, groupId, sourceId);
  return saveRecord(userId, groupId, sourceId, {
    position: stored,
    lastSyncedPosition: previous?.lastSyncedPosition ?? null,
    sync: {
      status: samePosition(stored, previous?.lastSyncedPosition ?? null) ? "clean" : "dirty",
      lastSyncAttemptAt: previous?.sync.lastSyncAttemptAt ?? null,
      lastSyncError: null,
    },
  });
}

function needsReadingPositionSync(record: ReadingPositionRecord | null): boolean {
  return !!record && !samePosition(record.position, record.lastSyncedPosition);
}

function markFailed(
  userId: string,
  groupId: string,
  sourceId: string,
  record: ReadingPositionRecord,
  error: string,
): ReadingPositionRecord {
  const current = getRecord(userId, groupId, sourceId) ?? record;
  return saveRecord(userId, groupId, sourceId, {
    ...current,
    sync: { status: "error", lastSyncAttemptAt: new Date().toISOString(), lastSyncError: error },
  });
}

function markSyncing(
  userId: string,
  groupId: string,
  sourceId: string,
  record: ReadingPositionRecord,
): ReadingPositionRecord {
  return saveRecord(userId, groupId, sourceId, {
    ...record,
    sync: { status: "syncing", lastSyncAttemptAt: new Date().toISOString(), lastSyncError: null },
  });
}

function mergeServerReadingPosition(
  userId: string,
  position: StoredReadingPosition,
): ReadingPositionRecord {
  const local = getRecord(userId, position.groupId, position.sourceId);
  const localPosition = local?.position ?? null;
  const chosen =
    localPosition && Date.parse(localPosition.updatedAt) > Date.parse(position.updatedAt)
      ? localPosition
      : position;
  return saveRecord(userId, position.groupId, position.sourceId, {
    position: chosen,
    lastSyncedPosition: position,
    sync: {
      status: samePosition(chosen, position) ? "clean" : "dirty",
      lastSyncAttemptAt: local?.sync.lastSyncAttemptAt ?? null,
      lastSyncError: null,
    },
  });
}

/** How a caller reaches the server. The local record cache is the same for
 *  every caller; only the transport differs, so a Foldkit Command can use the
 *  generated client while the React path keeps its own request helper. */
export interface ReadingPositionTransport<E> {
  fetch: (groupId: string, sourceId: string) => Effect.Effect<StoredReadingPosition | null, E>;
  push: (
    groupId: string,
    sourceId: string,
    position: StoredReadingPosition,
  ) => Effect.Effect<StoredReadingPosition | null, E>;
}

const requestTransport: ReadingPositionTransport<ApiRequestError> = {
  fetch: (groupId, sourceId) =>
    request(
      "ReadingPositions.fetch",
      `/me/reading-position?groupId=${encodeURIComponent(groupId)}&sourceId=${encodeURIComponent(sourceId)}`,
    ).pipe(
      Effect.flatMap((response) =>
        decodeJson("ReadingPositions.decodeFetch", response, ReadingPositionResponse),
      ),
      Effect.map((body) => body.position),
    ),
  push: (groupId, sourceId, position) =>
    request("ReadingPositions.sync", "/me/reading-position", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, sourceId, position }),
    }).pipe(
      Effect.flatMap((response) =>
        decodeJson("ReadingPositions.decodeSync", response, ReadingPositionResponse),
      ),
      Effect.map((body) => body.position),
    ),
};

export const fetchReadingPositionWith = Effect.fn("ReadingPositions.fetchWith")(function* <E>(
  transport: ReadingPositionTransport<E>,
  userId: string,
  groupId: string,
  sourceId: string,
): Effect.fn.Return<StoredReadingPosition | null, E> {
  const position = yield* transport.fetch(groupId, sourceId);
  if (position) mergeServerReadingPosition(userId, position);
  return position;
});

export const syncReadingPositionWith = Effect.fn("ReadingPositions.syncWith")(function* <E>(
  transport: ReadingPositionTransport<E>,
  userId: string,
  groupId: string,
  sourceId: string,
  force = false,
): Effect.fn.Return<boolean, E | ApiRequestError> {
  const key = positionKey(userId, groupId, sourceId);
  if (syncingKeys.has(key)) return false;
  const record = getRecord(userId, groupId, sourceId);
  if (!record || (!force && !needsReadingPositionSync(record))) return false;
  markSyncing(userId, groupId, sourceId, record);
  syncingKeys.add(key);
  const result = yield* transport.push(groupId, sourceId, record.position).pipe(
    Effect.flatMap((position) =>
      position
        ? Effect.succeed(position)
        : Effect.fail(
            new ApiRequestError({
              operation: "ReadingPositions.decodeSync",
              cause: new Error("missing_position"),
            }),
          ),
    ),
    Effect.tapError((error) =>
      Effect.sync(() => markFailed(userId, groupId, sourceId, record, String(error))),
    ),
    Effect.ensuring(Effect.sync(() => syncingKeys.delete(key))),
  );
  mergeServerReadingPosition(userId, result);
  return true;
});

export const fetchServerReadingPosition = (userId: string, groupId: string, sourceId: string) =>
  fetchReadingPositionWith(requestTransport, userId, groupId, sourceId);

export const syncReadingPosition = (
  userId: string,
  groupId: string,
  sourceId: string,
  force = false,
) => syncReadingPositionWith(requestTransport, userId, groupId, sourceId, force);
