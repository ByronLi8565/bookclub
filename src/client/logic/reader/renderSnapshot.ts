import type { SourceKind } from "../../../shared/types/sources.ts";
import * as Effect from "effect/Effect";
import { idbGet, idbPut, READER_SNAPSHOTS_STORE } from "../db.ts";

export interface RenderSnapshot {
  sourceId: string;
  kind: SourceKind;
  locationKey: string;
  width: number;
  height: number;
  dataUrl: string;
  capturedAt: number;
}

const MAX_SNAPSHOTS = 8;
const snapshots = new Map<string, RenderSnapshot>();

export async function getRenderSnapshot(
  sourceId: string | null | undefined,
): Promise<RenderSnapshot | null> {
  if (!sourceId) return null;
  const snapshot = snapshots.get(sourceId) ?? null;
  if (snapshot) {
    snapshots.delete(sourceId);
    snapshots.set(sourceId, snapshot);
    return snapshot;
  }
  const stored = await Effect.runPromise(
    idbGet<RenderSnapshot>(READER_SNAPSHOTS_STORE, sourceId).pipe(Effect.orElseSucceed(() => null)),
  );
  if (!stored) return null;
  remember(stored);
  return stored;
}

function remember(snapshot: RenderSnapshot): void {
  snapshots.delete(snapshot.sourceId);
  snapshots.set(snapshot.sourceId, snapshot);
  while (snapshots.size > MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value;
    if (!oldest) return;
    snapshots.delete(oldest);
  }
}

export async function putRenderSnapshot(snapshot: RenderSnapshot): Promise<void> {
  remember(snapshot);
  await Effect.runPromise(
    idbPut(READER_SNAPSHOTS_STORE, snapshot.sourceId, snapshot).pipe(Effect.ignore),
  );
}
