import * as Effect from "effect/Effect";
import type { ApplyOpsResult, Note, NoteAuthor, NoteOp } from "../../../shared/types/notes.ts";
import {
  applyOperations,
  emptyNoteState,
  type NoteState,
} from "../../../shared/notes/noteState.ts";
import { loadNotes, saveNotes, type StoredNotes } from "./notesCache.ts";

export interface NoteView {
  ready: boolean;
  notes: Note[];
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

// Incoming server snapshots never clear pending ops except by confirmed opId.
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

  hydrate = Effect.fn("NoteStore.hydrate")({ self: this }, function* (this: NoteStore) {
    yield* loadNotes(this.groupId).pipe(
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
      Effect.catch(() =>
        Effect.sync(() => {
          this.state = { ...this.state, hydrated: true };
          this.recompute();
        }),
      ),
      Effect.asVoid,
    );
  });

  ingestServer = Effect.fn("NoteStore.ingestServer")(
    { self: this },
    function* (this: NoteStore, snapshot: NoteState) {
      yield* Effect.sync(() => {
        const applied = new Set(snapshot.appliedOpIds ?? []);
        this.state = {
          ...this.state,
          hydrated: true,
          snapshot,
          pendingOps: this.state.pendingOps.filter((op) => !applied.has(op.opId)),
        };
        this.recompute();
      });
      yield* this.persist();
    },
  );

  enqueue = Effect.fn("NoteStore.enqueue")({ self: this }, function* (this: NoteStore, op: NoteOp) {
    yield* Effect.sync(() => {
      this.state = { ...this.state, pendingOps: [...this.state.pendingOps, op] };
      this.recompute();
    });
    yield* this.persist();
  });

  settle = Effect.fn("NoteStore.settle")(
    { self: this },
    function* (this: NoteStore, result: ApplyOpsResult) {
      yield* Effect.sync(() => {
        const applied = new Set(result.appliedOpIds);
        const rejected = new Set(result.rejectedOps.map((rejection) => rejection.opId));
        const failed = this.state.pendingOps.filter((op) => rejected.has(op.opId));
        this.state = {
          ...this.state,
          pendingOps: this.state.pendingOps.filter(
            (op) => !applied.has(op.opId) && !rejected.has(op.opId),
          ),
          failedOps: [...this.state.failedOps, ...failed],
        };
        this.recompute();
      });
      yield* this.persist();
    },
  );

  mergeForeign = Effect.fn("NoteStore.mergeForeign")(
    { self: this },
    function* (this: NoteStore, pendingOps: NoteOp[]) {
      yield* Effect.sync(() => {
        const seen = new Set(this.state.pendingOps.map((op) => op.opId));
        const additions = pendingOps.filter((op) => !seen.has(op.opId));
        if (additions.length === 0) return;
        this.state = { ...this.state, pendingOps: [...this.state.pendingOps, ...additions] };
        this.recompute();
      });
    },
  );

  private readonly persist = Effect.fn("NoteStore.persist")(
    { self: this },
    function* (this: NoteStore) {
      const record: StoredNotes = {
        userId: this.author.id,
        snapshot: this.state.snapshot,
        pendingOps: this.state.pendingOps,
        updatedAt: new Date().toISOString(),
      };
      yield* saveNotes(this.groupId, record).pipe(Effect.ignore);
    },
  );

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
