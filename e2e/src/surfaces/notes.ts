import { WebSocket } from "ws";
import { ulid } from "ulidx";
import type { ApplyOpsResult, Highlight, Note, NoteOp } from "../../../src/shared/types/notes.ts";
import type { NoteState } from "../../../src/shared/notes/noteState.ts";
import type { OnlinePeer } from "../../../src/server/state/NoteAgent.ts";
import type { Identity } from "./api.ts";

// The realtime surface: a black-box client that speaks the NoteAgent websocket
// protocol directly (the same wire the `agents` React client uses — identity,
// state broadcast, and `type:"rpc"` calls). It authenticates with the identity's
// session cookie on the handshake, exactly like the browser does same-origin.
// Scenarios use it to prove the collaborative guarantees (a note one member
// writes reaches another live; presence reflects who is connected) end to end,
// which no unit test of the reducer can cover.

const DEFAULT_TIMEOUT = 15_000;

export interface NotesSurface {
  /** Open an authenticated NoteAgent socket for `who` on the group's internal id. */
  connect(groupId: string, who: Identity): Promise<NoteSession>;
}

export interface NoteSession {
  /** Latest authoritative notes snapshot broadcast by the server. */
  notes(): Note[];
  /** Latest presence roster (who else is connected). */
  presence(): OnlinePeer[];
  /** Author a note via the durable op path; resolves with the server's ack. */
  addNote(sourceId: string, body: string, highlights?: Highlight[]): Promise<AddedNote>;
  /** Send a raw batch of ops (edit/remove/reply/rebind) and get the ack. */
  applyOperations(ops: NoteOp[]): Promise<ApplyOpsResult>;
  /** Resolve once the notes snapshot satisfies `predicate` (or reject on timeout). */
  waitForNotes(
    predicate: (notes: Note[]) => boolean,
    opts?: { timeout?: number; label?: string },
  ): Promise<Note[]>;
  /** Resolve once presence satisfies `predicate` (or reject on timeout). */
  waitForPresence(
    predicate: (peers: OnlinePeer[]) => boolean,
    opts?: { timeout?: number; label?: string },
  ): Promise<OnlinePeer[]>;
  close(): void;
}

export interface AddedNote {
  readonly noteId: string;
  readonly result: ApplyOpsResult;
}

interface ServerMessage {
  type?: string;
  state?: NoteState;
  users?: OnlinePeer[];
  id?: string;
  success?: boolean;
  result?: unknown;
  error?: string;
  done?: boolean;
}

export function makeNotesSurface(baseUrl: string): NotesSurface {
  const wsBase = baseUrl.replace(/^http/u, "ws");
  return {
    connect(groupId, who) {
      return openSession(wsBase, groupId, who);
    },
  };
}

function openSession(wsBase: string, groupId: string, who: Identity): Promise<NoteSession> {
  const url = `${wsBase}/agents/note-agent/${groupId}?_pk=${crypto.randomUUID()}`;
  const ws = new WebSocket(url, { headers: { Cookie: who.cookie } });

  let state: NoteState | null = null;
  let presence: OnlinePeer[] = [];
  let identified = false;
  const waiters = new Set<() => void>();
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  const notify = (): void => {
    // Snapshot: a waiter removes itself (and may resolve others) as it fires.
    for (const w of Array.from(waiters)) w();
  };

  ws.on("message", (data: Buffer | string) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data.toString()) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "cf_agent_identity":
        identified = true;
        break;
      case "cf_agent_state":
        if (msg.state) state = msg.state;
        break;
      case "presence":
        if (msg.users) presence = msg.users;
        break;
      case "rpc": {
        const call = msg.id ? pending.get(msg.id) : undefined;
        if (!call || !msg.id) break;
        pending.delete(msg.id);
        if (msg.success) call.resolve(msg.result);
        else call.reject(new Error(msg.error ?? "rpc failed"));
        break;
      }
    }
    notify();
  });

  const wait = <T>(
    getter: () => T,
    predicate: (value: T) => boolean,
    label: string,
    timeout: number,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        waiters.delete(check);
        reject(new Error(`timed out after ${timeout}ms waiting for ${label}`));
      }, timeout);
      const check = (): void => {
        if (settled || !predicate(getter())) return;
        settled = true;
        clearTimeout(timer);
        waiters.delete(check);
        resolve(getter());
      };
      waiters.add(check);
      check();
    });

  const call = <T>(method: string, args: unknown[], timeout = DEFAULT_TIMEOUT): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`rpc ${method} timed out after ${timeout}ms`));
      }, timeout);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ type: "rpc", id, method, args }));
    });

  const session: NoteSession = {
    notes: () => state?.notes ?? [],
    presence: () => presence,

    async addNote(sourceId, body, highlights = []) {
      const noteId = ulid();
      const op: NoteOp = {
        opId: ulid(),
        kind: "add",
        noteId,
        sourceId,
        body,
        highlights,
        createdAt: new Date().toISOString(),
      };
      const result = await call<ApplyOpsResult>("applyOperations", [[op]]);
      return { noteId, result };
    },

    applyOperations: (ops) => call<ApplyOpsResult>("applyOperations", [ops]),

    waitForNotes: (predicate, opts = {}) =>
      wait(
        () => state?.notes ?? [],
        predicate,
        opts.label ?? "notes",
        opts.timeout ?? DEFAULT_TIMEOUT,
      ),

    waitForPresence: (predicate, opts = {}) =>
      wait(() => presence, predicate, opts.label ?? "presence", opts.timeout ?? DEFAULT_TIMEOUT),

    close: () => ws.close(),
  };

  return new Promise<NoteSession>((resolve, reject) => {
    const openTimer = setTimeout(
      () => reject(new Error("websocket open timed out")),
      DEFAULT_TIMEOUT,
    );
    ws.on("open", () => {
      // Wait for the server's initial identity + state handshake so callers see a
      // ready session (state() is populated) rather than racing the first frames.
      void wait(
        () => identified && state !== null,
        (ready) => ready,
        "note-agent handshake",
        DEFAULT_TIMEOUT,
      )
        .then(() => {
          clearTimeout(openTimer);
          resolve(session);
        })
        .catch((err: unknown) => {
          clearTimeout(openTimer);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
    ws.on("error", (err) => {
      clearTimeout(openTimer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
