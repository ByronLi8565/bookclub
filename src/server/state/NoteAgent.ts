import {
  Agent,
  callable,
  type Connection,
  type ConnectionContext,
  getAgentByName,
  getCurrentAgent,
} from "agents";
import { monotonicFactory } from "ulidx";
import type {
  ApplyOpsResult,
  Highlight,
  HighlightAnchor,
  NoteOp,
} from "../../shared/types/notes.ts";
import type { GroupRole } from "../../shared/types/groups.ts";
import type { Env } from "../env.ts";
import { currentIdentity } from "../auth/cookies.ts";
import {
  addNote,
  addReply,
  applyOperations,
  editNote,
  emptyNoteState,
  rebindHighlight,
  removeNote,
  type NoteStamp,
  type NoteState,
} from "./noteState.ts";

export type { NoteState } from "./noteState.ts";

const ulid = monotonicFactory();

export interface ConnIdentity {
  userId: string;
  name: string;
  role: GroupRole;
}

export interface OnlinePeer {
  id: string;
  name: string;
  role: GroupRole;
}

export class NoteAgent extends Agent<Env, NoteState> {
  initialState: NoteState = emptyNoteState();

  private stamp: NoteStamp = { id: () => ulid(), now: () => new Date().toISOString() };

  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const me = await currentIdentity(ctx.request, this.env);
    if (!me) return connection.close(1008, "unauthenticated");
    const group = await getAgentByName(this.env.GroupAgent, this.name);
    const { isMember, role } = await group.membership(me.id);
    if (!isMember || role === null) return connection.close(1008, "forbidden");
    connection.setState({ userId: me.id, name: me.name, role } satisfies ConnIdentity);
    this.broadcastPresence();
  }

  onClose(connection: Connection): void {
    this.broadcastPresence(connection.id);
  }

  private broadcastPresence(excludeId?: string): void {
    const seen = new Map<string, OnlinePeer>();
    for (const conn of this.getConnections<ConnIdentity>()) {
      if (conn.id === excludeId) continue;
      const s = conn.state;
      if (s?.userId) seen.set(s.userId, { id: s.userId, name: s.name, role: s.role });
    }
    this.broadcast(JSON.stringify({ type: "presence", users: [...seen.values()] }));
  }

  private get me(): ConnIdentity {
    const { connection } = getCurrentAgent<NoteAgent>();
    if (!connection) throw new Error("note mutation outside a connection");
    return connection.state as ConnIdentity;
  }

  @callable()
  addNote(sourceId: string, body: string, highlights: Highlight[]): void {
    const { userId, name } = this.me;
    this.setState(
      addNote(this.state, sourceId, { id: userId, name }, body, highlights, this.stamp),
    );
  }

  @callable()
  addReply(sourceId: string, parent: string, body: string): void {
    const { userId, name } = this.me;
    this.setState(addReply(this.state, sourceId, { id: userId, name }, parent, body, this.stamp));
  }

  @callable()
  editNote(id: string, body: string): void {
    this.setState(editNote(this.state, id, body, this.stamp.now(), this.me.userId));
  }

  @callable()
  removeNote(id: string): void {
    const { userId, role } = this.me;
    this.setState(removeNote(this.state, id, this.stamp.now(), userId, role === "owner"));
  }

  @callable()
  rebindHighlight(noteId: string, highlightId: string, anchor: HighlightAnchor): void {
    this.setState(rebindHighlight(this.state, noteId, highlightId, anchor));
  }

  // The local-first write path: a batch of client-authored ops is folded into
  // authoritative state idempotently, in order. Author identity comes from the
  // connection (never the payload), so a replayed queue cannot be misattributed.
  // Returns which ops stuck and which were refused, so the client can prune its
  // pending queue and surface conflicts without ever silently losing authored
  // content. Reads `this.state` fresh: Durable Objects serialize RPC calls, so
  // each batch sees the previous batch's committed state.
  @callable()
  applyOperations(ops: NoteOp[]): ApplyOpsResult {
    const { userId, name, role } = this.me;
    const result = applyOperations(this.state, ops, {
      author: { id: userId, name },
      isOwner: role === "owner",
    });
    this.setState(result.state);
    return { appliedOpIds: result.appliedOpIds, rejectedOps: result.rejectedOps };
  }

  exportState(): NoteState {
    return this.state;
  }

  importState(state: NoteState): void {
    this.setState(state);
  }
}
