import type { SourceKind } from "../../../shared/types/sources.ts";

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

export function getRenderSnapshot(sourceId: string | null | undefined): RenderSnapshot | null {
  if (!sourceId) return null;
  const snapshot = snapshots.get(sourceId) ?? null;
  if (!snapshot) return null;
  snapshots.delete(sourceId);
  snapshots.set(sourceId, snapshot);
  return snapshot;
}

export function putRenderSnapshot(snapshot: RenderSnapshot): void {
  snapshots.delete(snapshot.sourceId);
  snapshots.set(snapshot.sourceId, snapshot);
  while (snapshots.size > MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value as string | undefined;
    if (!oldest) return;
    snapshots.delete(oldest);
  }
}
