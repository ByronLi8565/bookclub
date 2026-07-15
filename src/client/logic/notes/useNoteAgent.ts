import { useAgent } from "agents/react";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ApplyOpsResult, Note, NoteAuthor } from "../../../shared/types/notes.ts";
import type { NoteState } from "../../../shared/notes/noteState.ts";
import type { NoteAgent } from "../../../server/state/NoteAgent.ts";
import type { OnlinePeer } from "../../../server/state/NoteAgent.ts";
import type { Highlight, HighlightAnchor } from "./highlights.ts";
import {
  addNoteOp,
  addReplyOp,
  editNoteOp,
  rebindOp,
  removeNoteOp,
  updateTagsOp,
} from "./noteOps.ts";
import { NoteStore } from "./noteStore.ts";
import { spawnToast } from "../../ui/shared/toast/toastStore.ts";
import { apiOrigin, isNative, loadSessionToken } from "../net/api.ts";
import { useLatestRef } from "../useLatestRef.ts";

export type { OnlinePeer } from "../../../server/state/NoteAgent.ts";

export interface NoteSync {
  notes: Note[];
  notesReady: boolean;
  syncStatus: "syncing" | "online" | "offline";
  pendingCount: number;
  pendingNoteIds: ReadonlySet<string>;
  failedNoteIds: ReadonlySet<string>;
  online: OnlinePeer[];
  addNote: (sourceId: string, body: string, highlights: Highlight[], tags?: string[]) => boolean;
  addReply: (sourceId: string, parent: string, body: string, tags?: string[]) => boolean;
  editNote: (id: string, body: string, addTags?: string[], removeTags?: string[]) => boolean;
  updateTags: (id: string, add: string[], remove: string[]) => boolean;
  removeNote: (id: string) => boolean;
  rebindHighlight: (noteId: string, highlightId: string, anchor: HighlightAnchor) => boolean;
}

class FlushError extends Schema.TaggedErrorClass<FlushError>()("NoteSync.FlushError", {
  cause: Schema.Defect(),
}) {}

const retrySchedule = Schedule.exponential("300 millis").pipe(
  Schedule.jittered,
  // beta.83 does not yet expose Schedule.upTo; intersect with a counter to
  // bound the exponential schedule to four retries.
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

  const store = useMemo(
    () => (groupId && author ? new NoteStore(groupId, author, isOwner) : null),
    [groupId, author, isOwner],
  );

  const agent = useAgent<NoteAgent, NoteState>({
    agent: "note-agent",
    name: groupId ?? "idle",
    ...(isNative
      ? {
          host: new URL(apiOrigin).host,
          // null tokens are dropped by partysocket's query serializer, so an
          // unauthenticated socket simply omits the param (and the gate 401s).
          query: async () => ({ token: await loadSessionToken() }),
        }
      : {}),
    onStateUpdate: (state, source) => {
      if (source === "server" && store) Effect.runFork(store.ingestServer(state));
    },
    onMessage: (event) => {
      const msg = JSON.parse(event.data as string) as { type?: string; users?: OnlinePeer[] };
      if (msg.type === "presence" && msg.users) setPresence({ groupId, online: msg.users });
    },
  });

  const agentRef = useLatestRef(agent);
  const flushingRef = useRef(false);

  useEffect(() => {
    if (!store) return;
    const fiber = Effect.runFork(store.hydrate());
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [store]);

  const flush = (): void => {
    if (!store || flushingRef.current) return;
    const live = agentRef.current;
    if (live.readyState !== live.OPEN) return; // park; reconnect re-triggers
    const ops = store.pending();
    if (ops.length === 0) return;
    flushingRef.current = true;
    const sync = Effect.fn("NoteSync.flush")(function* () {
      const result: ApplyOpsResult = yield* Effect.tryPromise({
        try: () => live.stub.applyOperations(ops),
        catch: (cause) => new FlushError({ cause }),
      });
      yield* store.settle(result);
      if (result.rejectedOps.length > 0) {
        yield* Effect.sync(() =>
          spawnToast(
            "Some changes couldn't sync",
            "A note was edited or removed by someone else. Your change to it was skipped.",
            { type: "error", durationMs: 5000 },
          ),
        );
      }
    });
    const program = sync().pipe(
      Effect.retry(retrySchedule),
      // Pending operations remain persisted and reconnect will retry them.
      Effect.catch(() => Effect.void),
      Effect.ensuring(Effect.sync(() => (flushingRef.current = false))),
      Effect.andThen(
        Effect.sync(() => {
          if (store.hasPending()) flush();
        }),
      ),
    );
    Effect.runFork(program);
  };

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
    Effect.runFork(store.enqueue(op).pipe(Effect.andThen(Effect.sync(flush))));
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
    addNote: (sourceId, body, highlights, tags) =>
      enqueue(addNoteOp(sourceId, body, highlights, tags)),
    addReply: (sourceId, parent, body, tags) => enqueue(addReplyOp(sourceId, parent, body, tags)),
    editNote: (id, body, addTags, removeTags) => enqueue(editNoteOp(id, body, addTags, removeTags)),
    updateTags: (id, add, remove) => enqueue(updateTagsOp(id, add, remove)),
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
