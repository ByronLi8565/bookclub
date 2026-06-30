import { useAgent } from "agents/react";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ApplyOpsResult, Note, NoteAuthor } from "../../../shared/types/notes.ts";
import type { NoteState } from "../../../shared/notes/noteState.ts";
import type { NoteAgent } from "../../../server/state/NoteAgent.ts";
import type { OnlinePeer } from "../../../server/state/NoteAgent.ts";
import type { Highlight, HighlightAnchor } from "./highlights.ts";
import { addNoteOp, addReplyOp, editNoteOp, rebindOp, removeNoteOp } from "./noteOps.ts";
import { NoteStore } from "./noteStore.ts";
import { spawnToast } from "../../ui/shared/toast/toastStore.ts";

export type { OnlinePeer } from "../../../server/state/NoteAgent.ts";

export interface NoteSync {
  notes: Note[];
  notesReady: boolean;
  syncStatus: "syncing" | "online" | "offline";
  pendingCount: number;
  pendingNoteIds: ReadonlySet<string>;
  failedNoteIds: ReadonlySet<string>;
  online: OnlinePeer[];
  addNote: (sourceId: string, body: string, highlights: Highlight[]) => boolean;
  addReply: (sourceId: string, parent: string, body: string) => boolean;
  editNote: (id: string, body: string) => boolean;
  removeNote: (id: string) => boolean;
  rebindHighlight: (noteId: string, highlightId: string, anchor: HighlightAnchor) => boolean;
}

class FlushError extends Data.TaggedError("FlushError")<{ readonly cause: unknown }> {}

// Bounded, jittered backoff for transient transport failures. Offline is *not*
// modeled as a retry — flush short-circuits while the socket is closed and the
// reconnect re-triggers it, so we never burn attempts against a dead link.
const retrySchedule = Schedule.exponential("300 millis").pipe(
  Schedule.jittered,
  Schedule.both(Schedule.recurs(4)),
);

export function useNoteAgent(
  groupId: string | null,
  author: NoteAuthor | null,
  isOwner: boolean,
): NoteSync {
  const [presence, setPresence] = useState<{ groupId: string | null; online: OnlinePeer[] }>({
    groupId,
    online: [],
  });
  if (presence.groupId !== groupId) setPresence({ groupId, online: [] });

  // One store per (group, identity). Recreated synchronously when either
  // changes so a stale queue never leaks across groups or users.
  const storeKey = groupId && author ? `${groupId}:${author.id}` : null;
  const storeRef = useRef<{ key: string; store: NoteStore } | null>(null);
  if (storeKey && groupId && author && storeRef.current?.key !== storeKey) {
    storeRef.current = { key: storeKey, store: new NoteStore(groupId, author, isOwner) };
  }
  if (!storeKey) storeRef.current = null;
  const store = storeRef.current?.store ?? null;

  const agent = useAgent<NoteAgent, NoteState>({
    agent: "note-agent",
    name: groupId ?? "idle",
    onStateUpdate: (state, source) => {
      // Only the authoritative server snapshot updates our baseline. Pending
      // local ops are preserved and pruned by confirmed opId inside ingestServer.
      if (source === "server" && store) void Effect.runPromise(store.ingestServer(state));
    },
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type?: string; users?: OnlinePeer[] };
        if (msg.type === "presence" && msg.users) setPresence({ groupId, online: msg.users });
      } catch {}
    },
  });

  // Keep a live handle to the agent for the flush effect without re-creating it.
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const flushingRef = useRef(false);

  // Hydrate the local cache once per store so notes render offline immediately.
  useEffect(() => {
    if (!store) return;
    void Effect.runPromise(store.hydrate());
  }, [store]);

  const flush = (): void => {
    if (!store || flushingRef.current) return;
    const live = agentRef.current;
    if (live.readyState !== live.OPEN) return; // park; reconnect re-triggers
    const ops = store.pending();
    if (ops.length === 0) return;
    flushingRef.current = true;
    const program = Effect.tryPromise({
      try: () => live.stub.applyOperations(ops) as Promise<ApplyOpsResult>,
      catch: (cause) => new FlushError({ cause }),
    }).pipe(
      Effect.tap((result) => store.settle(result)),
      Effect.tap((result) =>
        result.rejectedOps.length > 0
          ? Effect.sync(() =>
              spawnToast(
                "Some changes couldn't sync",
                "A note was edited or removed by someone else. Your change to it was skipped.",
                { type: "error", durationMs: 5000 },
              ),
            )
          : Effect.void,
      ),
      Effect.retry(retrySchedule),
      // Out of retries (still failing) or offline: leave ops queued for the next
      // reconnect. Never drop them.
      Effect.catch(() => Effect.void),
      Effect.ensuring(Effect.sync(() => (flushingRef.current = false))),
    );
    void Effect.runPromise(program).then(() => {
      // Drain anything appended during the flight.
      if (store.hasPending()) flush();
    });
  };

  // Flush whenever we are connected and have unsynced work (covers initial
  // connect, reconnect, and freshly-enqueued ops).
  const view = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getView : emptyGetView,
    store ? store.getView : emptyGetView,
  );
  useEffect(() => {
    if (agent.readyState === agent.OPEN && view.pendingCount > 0) flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.readyState, view.pendingCount, store]);

  const enqueue = (op: ReturnType<typeof addNoteOp>): boolean => {
    if (!store) return false;
    void Effect.runPromise(store.enqueue(op)).then(() => flush());
    return true;
  };

  return {
    notes: groupId ? view.notes : [],
    notesReady: groupId ? view.ready : true,
    pendingCount: view.pendingCount,
    pendingNoteIds: view.pendingNoteIds,
    failedNoteIds: view.failedNoteIds,
    online: groupId && presence.groupId === groupId ? presence.online : [],
    syncStatus: syncStatus(
      groupId,
      agent.readyState,
      agent.CONNECTING,
      agent.OPEN,
      agent.identified,
      view.pendingCount,
    ),
    addNote: (sourceId, body, highlights) => enqueue(addNoteOp(sourceId, body, highlights)),
    addReply: (sourceId, parent, body) => enqueue(addReplyOp(sourceId, parent, body)),
    editNote: (id, body) => enqueue(editNoteOp(id, body)),
    removeNote: (id) => enqueue(removeNoteOp(id)),
    rebindHighlight: (noteId, highlightId, anchor) =>
      enqueue(rebindOp(noteId, highlightId, anchor)),
  };
}

function noopSubscribe(): () => void {
  return () => {};
}

const EMPTY_VIEW = {
  ready: true,
  notes: [] as Note[],
  pendingNoteIds: new Set<string>(),
  failedNoteIds: new Set<string>(),
  pendingCount: 0,
};
function emptyGetView(): typeof EMPTY_VIEW {
  return EMPTY_VIEW;
}

function syncStatus(
  groupId: string | null,
  readyState: number,
  connectingState: number,
  openState: number,
  identified: boolean,
  pendingCount: number,
): NoteSync["syncStatus"] {
  if (!groupId) return "syncing";
  if (readyState === openState) {
    if (!identified) return "syncing";
    return pendingCount > 0 ? "syncing" : "online";
  }
  if (readyState === connectingState) return "syncing";
  return "offline";
}
