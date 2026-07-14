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

function markSynced(
  userId: string,
  groupId: string,
  sourceId: string,
  position: StoredReadingPosition,
): ReadingPositionRecord {
  return saveRecord(userId, groupId, sourceId, {
    position,
    lastSyncedPosition: position,
    sync: { status: "clean", lastSyncAttemptAt: new Date().toISOString(), lastSyncError: null },
  });
}

function markFailed(
  userId: string,
  groupId: string,
  sourceId: string,
  record: ReadingPositionRecord,
  error: string,
): ReadingPositionRecord {
  return saveRecord(userId, groupId, sourceId, {
    ...record,
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

export const fetchServerReadingPosition = Effect.fn("ReadingPositions.fetch")(function* (
  userId: string,
  groupId: string,
  sourceId: string,
): Effect.fn.Return<StoredReadingPosition | null, ApiRequestError> {
  const response = yield* request(
    "ReadingPositions.fetch",
    `/me/reading-position?groupId=${encodeURIComponent(groupId)}&sourceId=${encodeURIComponent(sourceId)}`,
  );
  const body = yield* decodeJson("ReadingPositions.decodeFetch", response, ReadingPositionResponse);
  if (body.position) mergeServerReadingPosition(userId, body.position);
  return body.position;
});

export const syncReadingPosition = Effect.fn("ReadingPositions.sync")(function* (
  userId: string,
  groupId: string,
  sourceId: string,
  force = false,
): Effect.fn.Return<boolean, ApiRequestError> {
  const record = getRecord(userId, groupId, sourceId);
  if (!record || (!force && !needsReadingPositionSync(record))) return false;
  if (!force && record.sync.status === "syncing") return false;
  markSyncing(userId, groupId, sourceId, record);
  const result = yield* request("ReadingPositions.sync", "/me/reading-position", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId, sourceId, position: record.position }),
  }).pipe(
    Effect.flatMap((response) =>
      decodeJson("ReadingPositions.decodeSync", response, ReadingPositionResponse),
    ),
    Effect.flatMap((body) =>
      body.position
        ? Effect.succeed(body.position)
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
  );
  markSynced(userId, groupId, sourceId, result);
  return true;
});
