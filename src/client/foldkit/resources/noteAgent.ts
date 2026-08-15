import { AgentClient } from "agents/client";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ManagedResource, Subscription } from "foldkit";
import { m } from "foldkit/message";
import type { NoteAgent, OnlinePeer } from "../../../server/state/NoteAgent.ts";
import type { NoteState } from "../../../shared/notes/noteState.ts";
import { GroupRoleSchema } from "../../../shared/types/groups.ts";
import { Note, NoteAuthor, type ApplyOpsResult, type NoteOp } from "../../../shared/types/notes.ts";
import { apiOrigin, isNative, loadSessionToken } from "../../logic/net/api.ts";
import { NoteStore, type NotePersistence, type NoteView } from "../../logic/notes/noteStore.ts";

export type NoteSyncStatus = "syncing" | "online" | "offline";

const SessionMode = Schema.Literals(["web", "native"]);
export type SessionMode = typeof SessionMode.Type;

export const currentSessionMode = (): SessionMode => (isNative ? "native" : "web");

/**
 * The authenticated identity of a connection. A different group, a different
 * reader, a different ownership role, or a different session mode is a
 * different socket, so all four take part in the resource key.
 */
export const NoteAgentRequirements = Schema.Struct({
  groupId: Schema.String,
  author: NoteAuthor,
  isOwner: Schema.Boolean,
  sessionMode: SessionMode,
});
export type NoteAgentRequirements = typeof NoteAgentRequirements.Type;

const OnlinePeerSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: GroupRoleSchema,
  avatarImageId: Schema.optionalKey(Schema.String),
});

export const ConnectedNoteAgent = m("ConnectedNoteAgent", {
  groupId: Schema.String,
  agentName: Schema.String,
});
export const FailedNoteAgentConnection = m("FailedNoteAgentConnection", {
  groupId: Schema.String,
  reason: Schema.String,
});
export const ReleasedNoteAgent = m("ReleasedNoteAgent");
export const StampedNoteAgentIdentity = m("StampedNoteAgentIdentity", {
  agentName: Schema.String,
  agentClass: Schema.String,
});
export const ChangedNoteAgentStatus = m("ChangedNoteAgentStatus", {
  status: Schema.Literals(["syncing", "online", "offline"]),
});
export const ChangedNoteAgentPresence = m("ChangedNoteAgentPresence", {
  peers: Schema.Array(OnlinePeerSchema),
});
export const ChangedNotes = m("ChangedNotes", {
  ready: Schema.Boolean,
  notes: Schema.Array(Note),
  pendingNoteIds: Schema.Array(Schema.String),
  failedNoteIds: Schema.Array(Schema.String),
  pendingCount: Schema.Number,
});
export const RejectedNoteOperations = m("RejectedNoteOperations", { count: Schema.Number });
export const FailedNoteFlush = m("FailedNoteFlush", { reason: Schema.String });
export const QueuedNoteOperation = m("QueuedNoteOperation", { noteId: Schema.String });
export const DroppedNoteOperation = m("DroppedNoteOperation", {
  noteId: Schema.String,
  reason: Schema.String,
});

export type NoteAgentMessage =
  | typeof ConnectedNoteAgent.Type
  | typeof FailedNoteAgentConnection.Type
  | typeof ReleasedNoteAgent.Type
  | typeof StampedNoteAgentIdentity.Type
  | typeof ChangedNoteAgentStatus.Type
  | typeof ChangedNoteAgentPresence.Type
  | typeof ChangedNotes.Type
  | typeof RejectedNoteOperations.Type
  | typeof FailedNoteFlush.Type
  | typeof QueuedNoteOperation.Type
  | typeof DroppedNoteOperation.Type;

export type NoteAgentEvent =
  | { readonly kind: "identity"; readonly agentName: string; readonly agentClass: string }
  | { readonly kind: "status"; readonly status: NoteSyncStatus }
  | { readonly kind: "presence"; readonly peers: OnlinePeer[] }
  | { readonly kind: "notes"; readonly view: NoteView }
  | { readonly kind: "rejected"; readonly count: number }
  | { readonly kind: "flushFailed"; readonly reason: string };

export const noteAgentEventToMessage = (event: NoteAgentEvent): NoteAgentMessage => {
  switch (event.kind) {
    case "identity":
      return StampedNoteAgentIdentity({ agentName: event.agentName, agentClass: event.agentClass });
    case "status":
      return ChangedNoteAgentStatus({ status: event.status });
    case "presence":
      return ChangedNoteAgentPresence({ peers: event.peers });
    case "notes":
      return ChangedNotes({
        ready: event.view.ready,
        notes: event.view.notes,
        pendingNoteIds: [...event.view.pendingNoteIds],
        failedNoteIds: [...event.view.failedNoteIds],
        pendingCount: event.view.pendingCount,
      });
    case "rejected":
      return RejectedNoteOperations({ count: event.count });
    case "flushFailed":
      return FailedNoteFlush({ reason: event.reason });
  }
};

export type SocketState = "connecting" | "open" | "closed";

/**
 * The narrow slice of `AgentClient` this resource depends on. Keeping it this
 * small lets tests supply a transport without a live worker, and keeps the
 * partysocket surface from leaking into the Foldkit application.
 */
export interface NoteAgentSocket {
  readonly identified: boolean;
  readonly ready: Promise<void>;
  readonly state: () => SocketState;
  readonly applyOperations: (ops: NoteOp[]) => Promise<ApplyOpsResult>;
  readonly close: () => void;
}

export interface NoteAgentConnectOptions {
  readonly groupId: string;
  readonly sessionMode: SessionMode;
  readonly onSnapshot: (snapshot: NoteState) => void;
  readonly onPresence: (peers: OnlinePeer[]) => void;
  readonly onIdentity: (agentName: string, agentClass: string) => void;
  readonly onSocketState: () => void;
}

export type NoteAgentConnect = (options: NoteAgentConnectOptions) => NoteAgentSocket;

export const connectNoteAgent: NoteAgentConnect = ({
  groupId,
  sessionMode,
  onSnapshot,
  onPresence,
  onIdentity,
  onSocketState,
}) => {
  const native = sessionMode === "native";
  const client = new AgentClient<NoteAgent, NoteState>({
    agent: "note-agent",
    name: groupId,
    host: native ? new URL(apiOrigin).host : window.location.host,
    // null tokens are dropped by partysocket's query serializer, so an
    // unauthenticated socket simply omits the param (and the gate 401s).
    query: native ? async () => ({ token: await loadSessionToken() }) : undefined,
    onStateUpdate: (snapshot, source) => {
      if (source === "server") onSnapshot(snapshot);
    },
    onIdentity,
  });
  client.addEventListener("message", (event) => {
    // SAFETY: the Agent websocket protocol sends JSON text messages with this presence envelope.
    const parsed = JSON.parse(event.data as string) as { type?: string; users?: OnlinePeer[] };
    if (parsed.type === "presence" && parsed.users) onPresence(parsed.users);
  });
  client.addEventListener("open", onSocketState);
  client.addEventListener("close", onSocketState);
  client.addEventListener("error", onSocketState);
  return {
    get identified() {
      return client.identified;
    },
    get ready() {
      return client.ready;
    },
    state: () =>
      client.readyState === client.OPEN
        ? "open"
        : client.readyState === client.CONNECTING
          ? "connecting"
          : "closed",
    applyOperations: (ops) => client.stub.applyOperations(ops),
    close: () => client.close(),
  };
};

export interface NoteAgentConnection {
  readonly groupId: string;
  readonly agentName: string;
  readonly socket: NoteAgentSocket;
  readonly store: NoteStore;
  readonly events: Queue.Dequeue<NoteAgentEvent>;
  readonly status: () => NoteSyncStatus;
  readonly enqueue: (op: NoteOp) => Effect.Effect<void>;
  readonly requestFlush: Effect.Effect<void>;
}

export const NoteAgentResource = ManagedResource.tag<NoteAgentConnection>()("NoteAgent");
export type NoteAgentService = ManagedResource.ServiceOf<typeof NoteAgentResource>;

export class NoteAgentConnectionError extends Schema.TaggedError<NoteAgentConnectionError>()(
  "NoteAgent.ConnectionError",
  { groupId: Schema.String, cause: Schema.Defect() },
) {}

class NoteFlushError extends Schema.TaggedError<NoteFlushError>()("NoteAgent.FlushError", {
  cause: Schema.Defect(),
}) {}

// Same bound as the React reference: at most four retries of a jittered
// exponential backoff before the operations are parked for the next reconnect.
const defaultRetrySchedule = Schedule.exponential("300 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 4 }),
);

// Every event is a "latest wins" projection, so a slow consumer should drop the
// oldest rather than block a socket callback.
const EVENT_BUFFER = 128;

export interface NoteAgentResourceConfig<Model, Message> {
  readonly modelToRequirements: (model: Model) => Option.Option<NoteAgentRequirements>;
  readonly toMessage: (message: NoteAgentMessage) => Message;
  readonly connect?: NoteAgentConnect;
  readonly retrySchedule?: typeof defaultRetrySchedule;
  readonly persistence?: NotePersistence;
}

export interface NoteAgentAcquireOptions {
  readonly connect?: NoteAgentConnect;
  readonly retrySchedule?: typeof defaultRetrySchedule;
  readonly persistence?: NotePersistence;
}

export const acquireNoteAgent = (
  requirements: NoteAgentRequirements,
  options: NoteAgentAcquireOptions = {},
): Effect.Effect<NoteAgentConnection, NoteAgentConnectionError, Scope.Scope> =>
  Effect.gen(function* () {
    const { groupId, author, isOwner, sessionMode } = requirements;
    const connect = options.connect ?? connectNoteAgent;
    const retrySchedule = options.retrySchedule ?? defaultRetrySchedule;

    const events = yield* Queue.sliding<NoteAgentEvent>(EVENT_BUFFER);
    yield* Effect.addFinalizer(() => Queue.shutdown(events).pipe(Effect.asVoid));
    const publish = (event: NoteAgentEvent): void => {
      Queue.offerUnsafe(events, event);
    };

    const flushSignals = yield* Queue.sliding<void>(1);
    yield* Effect.addFinalizer(() => Queue.shutdown(flushSignals).pipe(Effect.asVoid));
    const requestFlush = Queue.offer(flushSignals, undefined).pipe(Effect.asVoid);
    const requestFlushUnsafe = (): void => {
      Queue.offerUnsafe(flushSignals, undefined);
    };

    const store =
      options.persistence === undefined
        ? new NoteStore(groupId, author, isOwner)
        : new NoteStore(groupId, author, isOwner, options.persistence);
    let identity = { agentName: groupId, agentClass: "note-agent" };
    let socket: NoteAgentSocket | null = null;

    const status = (): NoteSyncStatus => {
      const state = socket?.state() ?? "connecting";
      if (state === "open") {
        if (!socket?.identified) return "syncing";
        return store.hasPending() ? "syncing" : "online";
      }
      return state === "connecting" ? "syncing" : "offline";
    };
    const publishStatus = (): void => publish({ kind: "status", status: status() });

    const unsubscribe = store.subscribe(() => {
      publish({ kind: "notes", view: store.getView() });
      publishStatus();
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

    const live = yield* Effect.try({
      try: () =>
        connect({
          groupId,
          sessionMode,
          onSnapshot: (snapshot) => {
            Effect.runFork(store.ingestServer(snapshot));
          },
          onPresence: (peers) => publish({ kind: "presence", peers }),
          onIdentity: (agentName, agentClass) => {
            identity = { agentName, agentClass };
            publish({ kind: "identity", agentName, agentClass });
            publishStatus();
          },
          onSocketState: () => {
            publishStatus();
            // A reconnect re-triggers the flush the previous socket parked.
            requestFlushUnsafe();
          },
        }),
      catch: (cause) => new NoteAgentConnectionError({ groupId, cause }),
    });
    socket = live;

    // Registered before the handshake is awaited: a handshake that never
    // resolves must still release the socket when the scope closes.
    yield* Effect.addFinalizer(() => Effect.sync(() => live.close()));

    const flush = Effect.gen(function* () {
      if (live.state() !== "open") return; // park; reconnect re-triggers
      const ops = store.pending();
      if (ops.length === 0) return;
      const result = yield* Effect.tryPromise({
        try: () => live.applyOperations(ops),
        catch: (cause) => new NoteFlushError({ cause }),
      }).pipe(Effect.retry(retrySchedule));
      yield* store.settle(result);
      if (result.rejectedOps.length > 0) {
        publish({ kind: "rejected", count: result.rejectedOps.length });
      }
      if (store.hasPending()) yield* requestFlush;
    }).pipe(
      // Pending operations remain persisted and reconnect will retry them.
      Effect.catch((error) =>
        Effect.sync(() => publish({ kind: "flushFailed", reason: String(error) })),
      ),
    );

    yield* Effect.forkScoped(Stream.fromQueue(flushSignals).pipe(Stream.runForEach(() => flush)));

    yield* store.hydrate();

    yield* Effect.tryPromise({
      try: () => live.ready,
      catch: (cause) => new NoteAgentConnectionError({ groupId, cause }),
    });

    publishStatus();
    requestFlushUnsafe();

    return {
      groupId,
      get agentName() {
        return identity.agentName;
      },
      socket: live,
      store,
      events,
      status,
      enqueue: (op: NoteOp) => store.enqueue(op).pipe(Effect.andThen(requestFlush)),
      requestFlush,
    } satisfies NoteAgentConnection;
  });

export const makeNoteAgentResources = <Model, Message>(
  config: NoteAgentResourceConfig<Model, Message>,
) =>
  ManagedResource.make<Model, Message>()((entry) => ({
    noteAgent: entry(Schema.Option(NoteAgentRequirements), {
      resource: NoteAgentResource,
      modelToMaybeRequirements: config.modelToRequirements,
      acquire: (requirements) =>
        acquireNoteAgent(requirements, {
          connect: config.connect,
          retrySchedule: config.retrySchedule,
          persistence: config.persistence,
        }),
      // Teardown is registered inside `acquire` as scope finalizers so that an
      // unfinished acquisition releases exactly like a finished one.
      release: () => Effect.void,
      onAcquired: (connection) =>
        config.toMessage(
          ConnectedNoteAgent({ groupId: connection.groupId, agentName: connection.agentName }),
        ),
      onAcquireError: (error) =>
        config.toMessage(
          FailedNoteAgentConnection({
            groupId: error instanceof NoteAgentConnectionError ? error.groupId : "",
            reason: String(error),
          }),
        ),
      onReleased: () => config.toMessage(ReleasedNoteAgent()),
    }),
  }));

/**
 * Streams the live connection's callbacks into the Message loop.
 *
 * `modelToConnectionKey` returns the key of the connection the model believes
 * is live — null while none is. It must be null until `ConnectedNoteAgent`
 * arrives, because a stream started before acquisition finishes has nothing to
 * read, and it must change with the resource key, because a group switch hands
 * out a new event queue. Events published before the stream starts stay
 * buffered, so no presence or status update is lost to the gap.
 */
export const makeNoteAgentSubscriptions = <Model, Message>(config: {
  readonly modelToConnectionKey: (model: Model) => string | null;
  readonly toMessage: (message: NoteAgentMessage) => Message;
}) => {
  const noMessages: Stream.Stream<Message> = Stream.empty;
  return Subscription.make<Model, Message, NoteAgentService>()((entry) => ({
    noteAgentEvents: entry(
      { connectionKey: Schema.NullOr(Schema.String) },
      {
        modelToDependencies: (model) => ({ connectionKey: config.modelToConnectionKey(model) }),
        dependenciesToStream: ({ connectionKey }) =>
          connectionKey === null
            ? noMessages
            : Stream.unwrap(
                NoteAgentResource.get.pipe(
                  Effect.map((connection) =>
                    Stream.fromQueue(connection.events).pipe(
                      Stream.map((event) => config.toMessage(noteAgentEventToMessage(event))),
                    ),
                  ),
                  // A model that claims a connection before acquisition
                  // finishes simply has nothing to stream yet.
                  Effect.catch(() => Effect.succeed(noMessages)),
                ),
              ),
      },
    ),
  }));
};

/** Commands enqueue through the live connection; an absent one is a Message, not a defect. */
export const enqueueNoteOperation = (
  op: NoteOp,
): Effect.Effect<NoteAgentMessage, never, NoteAgentService> =>
  NoteAgentResource.get.pipe(
    Effect.flatMap((connection) => connection.enqueue(op)),
    Effect.as<NoteAgentMessage>(QueuedNoteOperation({ noteId: op.noteId })),
    Effect.catch((error) =>
      Effect.succeed<NoteAgentMessage>(
        DroppedNoteOperation({ noteId: op.noteId, reason: String(error) }),
      ),
    ),
  );
