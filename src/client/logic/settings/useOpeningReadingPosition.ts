import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { useEffect, useMemo, useState } from "react";
import type { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import type { SourceKind } from "../../../shared/types/sources.ts";
import type { ReadingPositionOpenPolicy } from "../../../shared/types/userPrefs.ts";
import { fetchServerReadingPosition, getReadingPosition } from "./readingPositions.ts";

interface OpeningPosition {
  key: string;
  position: SourceReadingPosition | null;
}

export function useOpeningReadingPosition({
  userId,
  groupId,
  sourceId,
  sourceKind,
  policy,
}: {
  userId: string | null;
  groupId: string | null;
  sourceId: string | null;
  sourceKind: SourceKind | null;
  policy: ReadingPositionOpenPolicy;
}): { ready: boolean; position: SourceReadingPosition | null } {
  const key =
    userId && groupId && sourceId && sourceKind ? `${userId}:${groupId}:${sourceId}` : null;
  const localPosition = useMemo(
    () =>
      userId && groupId && sourceId && sourceKind
        ? (getReadingPosition(userId, groupId, sourceId, sourceKind)?.position ?? null)
        : null,
    [userId, groupId, sourceId, sourceKind],
  );
  const [serverPosition, setServerPosition] = useState<OpeningPosition | null>(null);

  useEffect(() => {
    if (!key || !userId || !groupId || !sourceId || !sourceKind) return;
    const fiber = Effect.runFork(
      fetchServerReadingPosition(userId, groupId, sourceId).pipe(
        Effect.matchEffect({
          // A failed sync lookup must not strand an offline-capable reader on a
          // loading shell; the last local position remains the safe fallback.
          onFailure: () => Effect.sync(() => setServerPosition({ key, position: localPosition })),
          onSuccess: (position) =>
            Effect.sync(() => setServerPosition({ key, position: position ?? localPosition })),
        }),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [key, userId, groupId, sourceId, sourceKind, localPosition]);

  if (!key || policy === "prefer-local") return { ready: true, position: localPosition };
  if (serverPosition?.key !== key) return { ready: false, position: null };
  return { ready: true, position: serverPosition.position };
}
