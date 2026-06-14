import {
  Agent,
  callable,
  type Connection,
  type ConnectionContext,
  getAgentByName,
  getCurrentAgent,
} from "agents";
import { monotonicFactory } from "ulidx";
import type { Highlight } from "../client/highlights.ts";
import type { GroupRole } from "./GroupAgent.ts";
import { currentIdentity } from "./identity.ts";
import {
  addNote,
  addReply,
  editNote,
  emptyNoteState,
  rebindHighlight,
  removeNote,
  type NoteStamp,
  type NoteState,
} from "./noteState.ts";
import type { Env } from "./env.ts";

export type { NoteState } from "./noteState.ts";

// Monotonic so notes created within the same millisecond inside this
// single-threaded durable object still get strictly increasing, sortable ids.
const ulid = monotonicFactory();

// The server-authoritative identity stamped on each connection at connect time
// (ADR 0001). Read in mutations to attribute and authorize changes (Phase C).
export interface ConnIdentity {
  userId: string;
  name: string;
  role: GroupRole;
}

// Keyed by groupId (decision 6): one agent instance per group holds the notes
// for all of the group's books, so `seq` and `[[n]]` are group-global. The
// durable object is the source of truth for note identity, timestamps, and
// versions; clients send only the content of a change. All the note lifecycle
// rules live in the pure transitions in noteState.ts; this class just decodes a
// callable, applies one, and broadcasts the result via setState.
export class NoteAgent extends Agent<Env, NoteState> {
  initialState: NoteState = emptyNoteState();

  // Server-authored fields for new/changed notes; deterministic logic lives in
  // noteState.ts and reads these through the NoteStamp seam.
  private stamp: NoteStamp = { id: () => ulid(), now: () => new Date().toISOString() };

  // Defense-in-depth behind the worker's connect gate: re-validate the session
  // off the handshake cookie and confirm membership, then stamp the identity on
  // the connection so mutations can read it (ADR 0001). Close on failure.
  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const me = await currentIdentity(ctx.request, this.env);
    if (!me) return connection.close(1008, "unauthenticated");
    const group = await getAgentByName(this.env.GroupAgent, this.name);
    const { isMember, role } = await group.membership(me.id);
    if (!isMember || role === null) return connection.close(1008, "forbidden");
    connection.setState({ userId: me.id, name: me.name, role } satisfies ConnIdentity);
  }

  // The server-authoritative identity stamped on this connection at connect time
  // (ADR 0001). Mutations read it to attribute and authorize changes; it can
  // never be spoofed by a client message.
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
  rebindHighlight(noteId: string, highlightId: string, cfiValue: string): void {
    this.setState(rebindHighlight(this.state, noteId, highlightId, cfiValue));
  }
}
