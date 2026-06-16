import * as Schema from "effect/Schema";
import type { SourceKind } from "../../shared/types/sources.ts";
import {
  ReadingPositionCache,
  type SourceReadingPosition,
  type StoredReadingPosition,
} from "../../shared/types/readingPositions.ts";

const STORAGE_KEY = "bookclub.readingPositions";

function positionKey(userId: string, groupId: string, sourceId: string): string {
  return `${userId}:${groupId}:${sourceId}`;
}

function loadAll(): Record<string, StoredReadingPosition> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return Schema.decodeUnknownSync(
      ReadingPositionCache as unknown as Schema.Decoder<unknown, never>,
    )(JSON.parse(raw)) as Record<string, StoredReadingPosition>;
  } catch {
    return {};
  }
}

function saveAll(positions: Record<string, StoredReadingPosition>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {}
}

export function getReadingPosition(
  userId: string,
  groupId: string,
  sourceId: string,
  kind: SourceKind,
): StoredReadingPosition | null {
  const position = loadAll()[positionKey(userId, groupId, sourceId)];
  return position?.kind === kind && position.groupId === groupId && position.sourceId === sourceId
    ? position
    : null;
}

export function setReadingPosition(
  userId: string,
  groupId: string,
  sourceId: string,
  position: SourceReadingPosition,
): StoredReadingPosition {
  const stored = { ...position, groupId, sourceId, updatedAt: new Date().toISOString() };
  const positions = loadAll();
  positions[positionKey(userId, groupId, sourceId)] = stored;
  saveAll(positions);
  return stored;
}
