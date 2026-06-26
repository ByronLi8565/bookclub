import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SourceKind } from "../../../shared/types/sources.ts";
import {
  ReadingPositionCache,
  ReadingPositionResponse,
  type SourceReadingPosition,
  type ReadingPositionRecord,
  type StoredReadingPosition,
} from "../../../shared/types/readingPositions.ts";

const STORAGE_KEY = "bookclub.readingPositions";

function positionKey(userId: string, groupId: string, sourceId: string): string {
  return `${userId}:${groupId}:${sourceId}`;
}

function decode<S extends Schema.Top>(schema: S, value: unknown): Schema.Schema.Type<S> | null {
  try {
    return Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<unknown, never>)(
      value,
    ) as Schema.Schema.Type<S>;
  } catch {
    return null;
  }
}

function samePosition(a: StoredReadingPosition | null, b: StoredReadingPosition | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function loadAll(): Record<string, ReadingPositionRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return decode(ReadingPositionCache, JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

function saveAll(positions: Record<string, ReadingPositionRecord>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {}
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

export function fetchServerReadingPosition(
  userId: string,
  groupId: string,
  sourceId: string,
): Effect.Effect<StoredReadingPosition | null> {
  return Effect.tryPromise(async () => {
    const response = await fetch(
      `/me/reading-position?groupId=${encodeURIComponent(groupId)}&sourceId=${encodeURIComponent(sourceId)}`,
    );
    if (!response.ok) throw new Error(`http_${response.status}`);
    const body = decode(ReadingPositionResponse, await response.json());
    if (!body) throw new Error("bad_response");
    if (body.position) mergeServerReadingPosition(userId, body.position);
    return body.position;
  });
}

export function syncReadingPosition(
  userId: string,
  groupId: string,
  sourceId: string,
  force = false,
): Effect.Effect<boolean, unknown> {
  return Effect.gen(function* () {
    const record = getRecord(userId, groupId, sourceId);
    if (!record || (!force && !needsReadingPositionSync(record))) return false;
    if (!force && record.sync.status === "syncing") return false;
    markSyncing(userId, groupId, sourceId, record);
    const result = yield* Effect.tryPromise(async () => {
      const response = await fetch("/me/reading-position", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, sourceId, position: record.position }),
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const body = decode(ReadingPositionResponse, await response.json());
      if (!body?.position) throw new Error("bad_response");
      return body.position;
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => markFailed(userId, groupId, sourceId, record, String(error))),
      ),
    );
    markSynced(userId, groupId, sourceId, result);
    return true;
  });
}
