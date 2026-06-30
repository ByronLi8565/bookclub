import * as Effect from "effect/Effect";
import type { ApplyOpsResult, Note, NoteAuthor, NoteOp } from "../../../shared/types/notes.ts";
import {
  applyOperations,
  emptyNoteState,
  type NoteState,
} from "../../../shared/notes/noteState.ts";
import { loadNotes, saveNotes, type StoredNotes } from "./notesCache.ts";

export interface NoteView {
  // True once the local cache has been read, so the UI can show cached notes
  // (offline) without waiting for the server.
  ready: boolean;
  // Notes as the user should see them right now: the server snapshot with every
  // unsynced local op replayed on top. Provisional seqs continue from the
  // snapshot, so optimistic notes render with a stable (if not yet final) seq.
  notes: Note[];
  // Note ids with an op still waiting to sync, and ids whose op the server
  // refused — surfaced in the UI rather than dropped.
  pendingNoteIds: ReadonlySet<string>;
  failedNoteIds: ReadonlySet<string>;
  pendingCount: number;
}

interface Internal {
  hydrated: boolean;
  snapshot: NoteState;
  pendingOps: NoteOp[];
  failedOps: NoteOp[];
}

// In-memory op-log store for one group. React subscribes via useSyncExternal
// store; persistence and conflict resolution are expressed as Effects. The two
// load-bearing invariants live here:
//   1. An incoming server snapshot only ever replaces `snapshot`; it never
//      clears `pendingOps` except by confirmed opId. Unsynced authored work is
//      therefore never lost to another user's update.
//   2. The client never pushes state to the server from here — it only enqueues
//      ops that useNoteAgent flushes via the applyOperations RPC.
export class NoteStore {
  private state: Internal = {
    hydrated: false,
    snapshot: emptyNoteState(),
    pendingOps: [],
    failedOps: [],
  };
  private view: NoteView = emptyView();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly groupId: string,
    private readonly author: NoteAuthor,
    private readonly isOwner: boolean,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): NoteView => this.view;

  isHydrated = (): boolean => this.state.hydrated;

  pending = (): NoteOp[] => this.state.pendingOps;

  hasPending = (): boolean => this.state.pendingOps.length > 0;

  // Load any persisted snapshot + queue so notes render (and stay editable)
  // offline immediately. A queue authored by a different user is discarded
  // rather than flushed under the current identity.
  hydrate(): Effect.Effect<void> {
    return loadNotes(this.groupId).pipe(
      Effect.tap((stored) =>
        Effect.sync(() => {
          if (stored && stored.userId === this.author.id) {
            this.state = {
              hydrated: true,
              snapshot: stored.snapshot,
              pendingOps: stored.pendingOps,
              failedOps: [],
            };
          } else {
            this.state = { ...this.state, hydrated: true };
          }
          this.recompute();
        }),
      ),
      // A read failure must not block the UI; we just start from empty state.
      Effect.catch(() =>
        Effect.sync(() => {
          this.state = { ...this.state, hydrated: true };
          this.recompute();
        }),
      ),
      Effect.asVoid,
    );
  }

  // Authoritative state arrived over the socket. Replace the snapshot and prune
  // any pending op the server reports as applied (the durable, reconnect-safe
  // confirmation path). Pending is never cleared by mere arrival of an update.
  ingestServer(snapshot: NoteState): Effect.Effect<void> {
    return Effect.sync(() => {
      const applied = new Set(snapshot.appliedOpIds ?? []);
      this.state = {
        ...this.state,
        hydrated: true,
        snapshot,
        pendingOps: this.state.pendingOps.filter((op) => !applied.has(op.opId)),
      };
      this.recompute();
    }).pipe(Effect.andThen(this.persist()));
  }

  // Append a locally-authored op: write-ahead (persist before any flush) so a
  // crash mid-sync still has the op durably queued for replay.
  enqueue(op: NoteOp): Effect.Effect<void> {
    return Effect.sync(() => {
      this.state = { ...this.state, pendingOps: [...this.state.pendingOps, op] };
      this.recompute();
    }).pipe(Effect.andThen(this.persist()));
  }

  // Apply the direct RPC result: prune confirmed ops and move refused ops to the
  // failed list so their authors can see them instead of losing them silently.
  settle(result: ApplyOpsResult): Effect.Effect<void> {
    return Effect.sync(() => {
      const applied = new Set(result.appliedOpIds);
      const rejected = new Set(result.rejectedOps.map((r) => r.opId));
      const failed = this.state.pendingOps.filter((op) => rejected.has(op.opId));
      this.state = {
        ...this.state,
        pendingOps: this.state.pendingOps.filter(
          (op) => !applied.has(op.opId) && !rejected.has(op.opId),
        ),
        failedOps: [...this.state.failedOps, ...failed],
      };
      this.recompute();
    }).pipe(Effect.andThen(this.persist()));
  }

  // Merge a sibling tab's queue (via BroadcastChannel). Union by opId keeps a
  // just-authored op in one tab from being clobbered by another tab's persist.
  mergeForeign(pendingOps: NoteOp[]): Effect.Effect<void> {
    return Effect.sync(() => {
      const seen = new Set(this.state.pendingOps.map((op) => op.opId));
      const additions = pendingOps.filter((op) => !seen.has(op.opId));
      if (additions.length === 0) return;
      this.state = { ...this.state, pendingOps: [...this.state.pendingOps, ...additions] };
      this.recompute();
    });
  }

  private persist(): Effect.Effect<void> {
    const record: StoredNotes = {
      userId: this.author.id,
      snapshot: this.state.snapshot,
      pendingOps: this.state.pendingOps,
      updatedAt: new Date().toISOString(),
    };
    // Persistence failure (quota, private mode) degrades durability but must not
    // crash the session; it is logged via the error channel by callers if needed.
    return saveNotes(this.groupId, record).pipe(Effect.ignore);
  }

  private recompute(): void {
    const { snapshot, pendingOps, failedOps } = this.state;
    const { state } = applyOperations(snapshot, pendingOps, {
      author: this.author,
      isOwner: this.isOwner,
    });
    this.view = {
      ready: this.state.hydrated,
      notes: state.notes,
      pendingNoteIds: new Set(pendingOps.map((op) => op.noteId)),
      failedNoteIds: new Set(failedOps.map((op) => op.noteId)),
      pendingCount: pendingOps.length,
    };
    for (const listener of this.listeners) listener();
  }
}

function emptyView(): NoteView {
  return {
    ready: false,
    notes: [],
    pendingNoteIds: new Set(),
    failedNoteIds: new Set(),
    pendingCount: 0,
  };
}
