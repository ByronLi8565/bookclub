// @vitest-environment jsdom

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { Runtime } from "foldkit";
import { m } from "foldkit/message";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireNoteAgent,
  ChangedNoteAgentPresence,
  makeNoteAgentResources,
  makeNoteAgentSubscriptions,
  noteAgentEventToMessage,
  ReleasedNoteAgent,
  type NoteAgentConnect,
  type NoteAgentConnectOptions,
  type NoteAgentEvent,
  type NoteAgentMessage,
  type NoteAgentRequirements,
  type NoteAgentSocket,
  type SocketState,
} from "../../client/foldkit/resources/noteAgent.ts";
import { addNoteOp } from "../../client/logic/notes/noteOps.ts";
import type { NotePersistence } from "../../client/logic/notes/noteStore.ts";
import type { StoredNotes } from "../../client/logic/notes/notesCache.ts";
import { applyOperations, emptyNoteState } from "../../shared/notes/noteState.ts";
import { NoteRejectionReason, type ApplyOpsResult, type NoteOp } from "../../shared/types/notes.ts";

const author = { id: "reader-1", name: "Reader One" };

const requirementsFor = (groupId: string): NoteAgentRequirements => ({
  groupId,
  author,
  isOwner: false,
  sessionMode: "web",
});

const memoryPersistence = (): NotePersistence & { readonly saved: StoredNotes[] } => {
  const saved: StoredNotes[] = [];
  return {
    saved,
    load: () => Effect.succeed(null),
    save: (_groupId, value) => Effect.sync(() => void saved.push(value)),
  };
};

const appliedResult = (ops: NoteOp[]): ApplyOpsResult => ({
  appliedOpIds: ops.map((op) => op.opId),
  rejectedOps: [],
});

interface FakeConnection {
  readonly options: NoteAgentConnectOptions;
  readonly socket: NoteAgentSocket;
  readonly applied: NoteOp[][];
  readonly closeCount: () => number;
  readonly completeHandshake: () => void;
  readonly drop: () => void;
}

interface FakeTransport {
  readonly connect: NoteAgentConnect;
  readonly connections: FakeConnection[];
}

const makeTransport = (
  config: {
    readonly hangHandshake?: boolean;
    readonly apply?: (ops: NoteOp[]) => Promise<ApplyOpsResult>;
  } = {},
): FakeTransport => {
  const connections: FakeConnection[] = [];
  const connect: NoteAgentConnect = (options) => {
    let state: SocketState = "connecting";
    let identified = false;
    let closes = 0;
    const applied: NoteOp[][] = [];
    let settleReady = (): void => {};
    const ready = new Promise<void>((resolve) => {
      settleReady = resolve;
    });
    const socket: NoteAgentSocket = {
      get identified() {
        return identified;
      },
      get ready() {
        return ready;
      },
      state: () => state,
      applyOperations: (ops) => {
        applied.push(ops);
        return config.apply ? config.apply(ops) : Promise.resolve(appliedResult(ops));
      },
      close: () => {
        closes += 1;
        state = "closed";
        identified = false;
      },
    };
    const completeHandshake = (): void => {
      state = "open";
      identified = true;
      options.onIdentity(`stamped-${options.groupId}`, "note-agent");
      options.onSocketState();
      settleReady();
    };
    connections.push({
      options,
      socket,
      applied,
      closeCount: () => closes,
      completeHandshake,
      drop: () => {
        state = "closed";
        identified = false;
        options.onSocketState();
      },
    });
    // A real handshake settles after the constructor returns.
    if (config.hangHandshake !== true) queueMicrotask(completeHandshake);
    return socket;
  };
  return { connect, connections };
};

describe("NoteAgent managed resource", () => {
  it("acquires on the notes already stored, without waiting for a handshake", async () => {
    // The offline case: the socket never completes its handshake, and the panel
    // still opens on the notes this device is holding. Waiting here is what left
    // a reader with no connection staring at a loading pane.
    const transport = makeTransport({ hangHandshake: true });
    const persistence = memoryPersistence();

    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* acquireNoteAgent(requirementsFor("club-alpha"), {
            connect: transport.connect,
            persistence,
          });
          const atAcquire = {
            groupId: connection.groupId,
            agentName: connection.agentName,
            status: connection.status(),
            ready: connection.store.getView().ready,
          };

          transport.connections[0]?.completeHandshake();
          yield* Effect.promise(() => vi.waitFor(() => expect(connection.status()).toBe("online")));
          return { atAcquire, agentName: connection.agentName };
        }),
      ),
    );

    expect(observed.atAcquire).toEqual({
      groupId: "club-alpha",
      // The server stamps the instance name during the handshake, so until then
      // the resource answers with the group it was asked for.
      agentName: "club-alpha",
      status: "syncing",
      ready: true,
    });
    expect(observed.agentName).toBe("stamped-club-alpha");
    expect(transport.connections).toHaveLength(1);
    expect(transport.connections[0]?.options.sessionMode).toBe("web");
  });

  it("closes a socket whose handshake never completes, when the scope goes", async () => {
    const transport = makeTransport({ hangHandshake: true });
    // `Effect.never` holds the scope open past acquisition, which now finishes
    // without the handshake; the socket must still be closed on the way out.
    const fiber = Effect.runFork(
      Effect.scoped(
        acquireNoteAgent(requirementsFor("club-alpha"), {
          connect: transport.connect,
          persistence: memoryPersistence(),
        }).pipe(Effect.andThen(Effect.never)),
      ),
    );

    await vi.waitFor(() => expect(transport.connections).toHaveLength(1));
    expect(transport.connections[0]?.closeCount()).toBe(0);

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(transport.connections[0]?.closeCount()).toBe(1);
  });

  it("flushes pending operations and settles them against the op log", async () => {
    const transport = makeTransport();
    const persistence = memoryPersistence();
    const op = addNoteOp("source-1", "a note", []);

    const notesAfterSnapshot = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* acquireNoteAgent(requirementsFor("club-alpha"), {
            connect: transport.connect,
            persistence,
          });
          yield* connection.enqueue(op);
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(connection.store.hasPending()).toBe(false)),
          );
          // The applied op only becomes a note when the agent broadcasts the
          // committed snapshot back, exactly as the server does.
          const { state } = applyOperations(emptyNoteState(), [op], { author, isOwner: false });
          transport.connections[0]?.options.onSnapshot(state);
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(connection.store.getView().notes).toHaveLength(1)),
          );
          return connection.store.getView().notes.map((note) => note.body);
        }),
      ),
    );

    expect(transport.connections[0]?.applied).toEqual([[op]]);
    expect(notesAfterSnapshot).toEqual(["a note"]);
    // The op log persists the pending op, the settled empty queue, and the
    // committed server snapshot, so a restart never replays an applied op.
    expect(persistence.saved.map((record) => record.pendingOps.length)).toEqual([1, 0, 0]);
    expect(persistence.saved.at(-1)?.snapshot.notes).toHaveLength(1);
  });

  it("publishes a rejection Message instead of dropping a conflicting operation", async () => {
    const transport = makeTransport({
      apply: (ops) =>
        Promise.resolve({
          appliedOpIds: [],
          rejectedOps: ops.map((op) => ({ opId: op.opId, reason: NoteRejectionReason.Gone })),
        }),
    });
    const op = addNoteOp("source-1", "a doomed note", []);

    const messages = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* acquireNoteAgent(requirementsFor("club-alpha"), {
            connect: transport.connect,
            persistence: memoryPersistence(),
          });
          yield* connection.enqueue(op);
          const events = yield* Effect.promise(() =>
            vi.waitFor(async () => {
              const drained = await Effect.runPromise(drainEvents(connection.events));
              expect(drained.some((event) => event._tag === "RejectedNoteOperations")).toBe(true);
              return drained;
            }),
          );
          return events;
        }),
      ),
    );

    expect(messages).toContainEqual({ _tag: "RejectedNoteOperations", count: 1 });
  });

  it("gives up after the bounded retry and reports a flush failure Message", async () => {
    let attempts = 0;
    const transport = makeTransport({
      apply: () => {
        attempts += 1;
        return Promise.reject(new Error("socket died"));
      },
    });

    const messages = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* acquireNoteAgent(requirementsFor("club-alpha"), {
            connect: transport.connect,
            persistence: memoryPersistence(),
            // The production schedule's bound is four retries; the delays are
            // what makes it unusable in a unit test, not the bound.
            retrySchedule: Schedule.upTo({ times: 4 })(Schedule.exponential("1 millis")),
          });
          yield* connection.enqueue(addNoteOp("source-1", "a note", []));
          return yield* Effect.promise(() =>
            vi.waitFor(async () => {
              const drained = await Effect.runPromise(drainEvents(connection.events));
              expect(drained.some((event) => event._tag === "FailedNoteFlush")).toBe(true);
              return drained;
            }),
          );
        }),
      ),
    );

    expect(attempts).toBe(5);
    expect(messages.some((event) => event._tag === "FailedNoteFlush")).toBe(true);
  });

  it("re-flushes parked operations when a dropped socket reconnects", async () => {
    const transport = makeTransport();
    const op = addNoteOp("source-1", "a note", []);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* acquireNoteAgent(requirementsFor("club-alpha"), {
            connect: transport.connect,
            persistence: memoryPersistence(),
          });
          const fake = transport.connections[0];
          // Acquisition no longer waits for the socket, so the drop has to.
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(connection.socket.state()).toBe("open")),
          );
          yield* drainEvents(connection.events);
          fake?.drop();
          expect(yield* drainEvents(connection.events)).toContainEqual({
            _tag: "ChangedNoteAgentStatus",
            status: "offline",
          });
          yield* connection.enqueue(op);
          yield* Effect.sleep("10 millis");
          expect(fake?.applied).toEqual([]);
          expect(connection.store.hasPending()).toBe(true);
          expect(yield* drainEvents(connection.events)).toContainEqual(
            expect.objectContaining({ _tag: "ChangedNotes", pendingCount: 1 }),
          );

          fake?.completeHandshake();
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(connection.store.hasPending()).toBe(false)),
          );
          expect(fake?.applied).toEqual([[op]]);
          expect(yield* drainEvents(connection.events)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ _tag: "ChangedNoteAgentStatus", status: "online" }),
              expect.objectContaining({ _tag: "ChangedNotes", pendingCount: 0 }),
            ]),
          );
        }),
      ),
    );
  });
});

const drainEvents = (events: Queue.Dequeue<NoteAgentEvent>): Effect.Effect<NoteAgentMessage[]> =>
  Queue.takeAll(events).pipe(Effect.map((taken) => [...taken].map(noteAgentEventToMessage)));

const Model = Schema.Struct({
  groupId: Schema.NullOr(Schema.String),
  connected: Schema.Boolean,
  /** The connection the Model believes is live, cleared only by `ReleasedNoteAgent`
   *  — the same lag the app's notes slice has, and the window the release has to
   *  survive. */
  connectionKey: Schema.NullOr(Schema.String),
  peers: Schema.Array(Schema.String),
  log: Schema.Array(Schema.String),
});
type Model = typeof Model.Type;

const SwitchedGroup = m("SwitchedGroup", { groupId: Schema.NullOr(Schema.String) });
type Message = typeof SwitchedGroup.Type | NoteAgentMessage;

const update = (model: Model, message: Message): readonly [Model, []] => {
  const log = [...model.log, message._tag];
  switch (message._tag) {
    case "SwitchedGroup":
      return [{ ...model, groupId: message.groupId, connected: false, peers: [], log }, []];
    case "ConnectedNoteAgent":
      return [{ ...model, connected: true, connectionKey: message.groupId, log }, []];
    case "ReleasedNoteAgent":
    case "FailedNoteAgentConnection":
      return [{ ...model, connected: false, connectionKey: null, peers: [], log }, []];
    case "ChangedNoteAgentPresence":
      return [{ ...model, peers: message.peers.map((peer) => peer.name), log }, []];
    default:
      return [{ ...model, log }, []];
  }
};

describe("NoteAgent managed resource inside a Foldkit runtime", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  const startRuntime = (transport: FakeTransport) => {
    const container = document.createElement("div");
    container.id = "note-agent-resource-test";
    document.body.appendChild(container);

    const managedResources = makeNoteAgentResources<Model, Message>({
      modelToRequirements: (model) =>
        model.groupId === null ? Option.none() : Option.some(requirementsFor(model.groupId)),
      toMessage: (message) => message,
      connect: transport.connect,
      persistence: memoryPersistence(),
    });
    const subscriptions = makeNoteAgentSubscriptions<Model, Message>({
      modelToConnectionKey: (model) => model.connectionKey,
      toMessage: (message) => message,
    });

    return Runtime.embed(
      Runtime.makeElement({
        Model,
        container,
        init: () =>
          [
            { groupId: "club-alpha", connected: false, connectionKey: null, peers: [], log: [] },
            [],
          ] as const,
        update,
        view: (model, h) =>
          h.main(
            [],
            [
              h.p([], [`log:${model.log.join(",")}`]),
              h.p([], [`peers:${model.peers.join(",")}`]),
              h.button([h.OnClick(SwitchedGroup({ groupId: "club-beta" }))], ["switch"]),
              h.button([h.OnClick(SwitchedGroup({ groupId: null }))], ["leave"]),
            ],
          ),
        managedResources,
        subscriptions,
        devTools: false,
      }),
    );
  };

  const log = (): string => document.querySelector("p")?.textContent ?? "";
  const peers = (): string => document.querySelectorAll("p")[1]?.textContent ?? "";
  const button = (label: string): HTMLButtonElement | undefined =>
    [...document.querySelectorAll("button")].find((element) => element.textContent === label);

  it("maps presence callbacks to Messages and releases the prior connection on a key change", async () => {
    const transport = makeTransport();
    const handle = startRuntime(transport);

    await vi.waitFor(() => expect(transport.connections).toHaveLength(1));
    await vi.waitFor(() => expect(log()).toContain("ConnectedNoteAgent"));

    transport.connections[0]?.options.onPresence([
      { id: "reader-2", name: "Reader Two", role: "member" },
    ]);
    await vi.waitFor(() => expect(peers()).toBe("peers:Reader Two"));

    button("switch")?.click();
    await vi.waitFor(() => expect(transport.connections).toHaveLength(2));
    expect(transport.connections[1]?.options.groupId).toBe("club-beta");
    // Foldkit releases the previous resource on a forked interrupt, so the old
    // close can land after the new acquire. The replacement must survive it.
    await vi.waitFor(() => expect(transport.connections[0]?.closeCount()).toBe(1));
    await vi.waitFor(() => expect(log()).toContain("ReleasedNoteAgent"));
    expect(transport.connections[1]?.closeCount()).toBe(0);

    transport.connections[1]?.options.onPresence([
      { id: "reader-3", name: "Reader Three", role: "member" },
    ]);
    await vi.waitFor(() => expect(peers()).toBe("peers:Reader Three"));

    handle.dispose();
    await vi.waitFor(() => expect(transport.connections[1]?.closeCount()).toBe(1));
  });

  it("puts stored notes in the Model when the handshake never lands", async () => {
    // The whole offline chain: no socket ever opens, the resource still resolves,
    // and the notes view reaches the Model — which is what lets the panel render
    // instead of sitting on its loading state.
    const transport = makeTransport({ hangHandshake: true });
    const handle = startRuntime(transport);

    await vi.waitFor(() => expect(log()).toContain("ConnectedNoteAgent"));
    await vi.waitFor(() => expect(log()).toContain("ChangedNotes"));
    expect(transport.connections[0]?.closeCount()).toBe(0);

    handle.dispose();
  });

  it("survives the release when the Model still believes the connection is live", async () => {
    // Leaving a club drops the resource's requirements at once while the Model
    // holds the connection key until `ReleasedNoteAgent` lands. The finalizer
    // shuts the event queue down inside that window, and an interruption
    // reaching the subscription there took the whole application down with it.
    const transport = makeTransport();
    const handle = startRuntime(transport);

    await vi.waitFor(() => expect(log()).toContain("ConnectedNoteAgent"));
    button("leave")?.click();

    await vi.waitFor(() => expect(log()).toContain("ReleasedNoteAgent"));
    expect(document.body.textContent).not.toContain("Application Crash");
    // Still the application's own view, still taking messages.
    expect(button("switch")).toBeDefined();

    handle.dispose();
  });

  it("releases the connection when the model leaves the group and on runtime shutdown", async () => {
    const transport = makeTransport();
    const handle = startRuntime(transport);

    await vi.waitFor(() => expect(log()).toContain("ConnectedNoteAgent"));
    button("leave")?.click();
    await vi.waitFor(() => expect(transport.connections[0]?.closeCount()).toBe(1));
    expect(transport.connections).toHaveLength(1);

    handle.dispose();
    expect(transport.connections[0]?.closeCount()).toBe(1);
  });
});

// Guards the shape the update loop pattern-matches on.
it("maps every connection event kind to a domain Message", () => {
  expect(noteAgentEventToMessage({ kind: "status", status: "offline" })._tag).toBe(
    "ChangedNoteAgentStatus",
  );
  expect(noteAgentEventToMessage({ kind: "presence", peers: [] })).toEqual(
    ChangedNoteAgentPresence({ peers: [] }),
  );
  expect(
    noteAgentEventToMessage({
      kind: "notes",
      view: {
        ready: true,
        notes: [],
        pendingNoteIds: new Set(["a"]),
        failedNoteIds: new Set<string>(),
        pendingCount: 1,
      },
    }),
  ).toEqual({
    _tag: "ChangedNotes",
    ready: true,
    notes: [],
    pendingNoteIds: ["a"],
    failedNoteIds: [],
    pendingCount: 1,
  });
  expect(noteAgentEventToMessage({ kind: "rejected", count: 2 })._tag).toBe(
    "RejectedNoteOperations",
  );
  expect(noteAgentEventToMessage({ kind: "flushFailed", reason: "x" })._tag).toBe(
    "FailedNoteFlush",
  );
  expect(ReleasedNoteAgent()._tag).toBe("ReleasedNoteAgent");
  expect(emptyNoteState().notes).toEqual([]);
});
