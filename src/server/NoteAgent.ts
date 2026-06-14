import { Agent, callable, getCurrentAgent } from "agents";
import { monotonicFactory } from "ulidx";
import type { Highlight } from "../client/highlights.ts";
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

// Keyed by sourceId (book hash): everyone with the same book annotates the same
// agent instance. The durable object is the source of truth for note identity,
// timestamps, and versions; clients send only the content of a change. All the
// note lifecycle rules live in the pure transitions in noteState.ts; this class
// just decodes a callable, applies one, and broadcasts the result via setState.
export class NoteAgent extends Agent<Env, NoteState> {
  initialState: NoteState = emptyNoteState();

  // Server-authored fields for new/changed notes; deterministic logic lives in
  // noteState.ts and reads these through the NoteStamp seam.
  private stamp: NoteStamp = { id: () => ulid(), now: () => new Date().toISOString() };

  @callable()
  addNote(body: string, highlights: Highlight[]): void {
    this.setState(addNote(this.state, this.name, body, highlights, this.stamp));
  }

  @callable()
  addReply(parent: string, body: string): void {
    this.setState(addReply(this.state, this.name, parent, body, this.stamp));
  }

  @callable()
  editNote(id: string, body: string): void {
    this.setState(editNote(this.state, id, body, this.stamp.now()));
  }

  @callable()
  removeNote(id: string): void {
    this.setState(removeNote(this.state, id, this.stamp.now()));
  }

  @callable()
  rebindHighlight(noteId: string, highlightId: string, cfiValue: string): void {
    this.setState(rebindHighlight(this.state, noteId, highlightId, cfiValue));
  }

  // TEMP spike: prove a @callable can see its originating connection.
  @callable()
  __whoami(): { hasConnection: boolean; connectionId: string | null; state: unknown } {
    const { connection } = getCurrentAgent();
    if (connection) connection.setState({ stamped: "server-only" });
    return {
      hasConnection: connection !== undefined,
      connectionId: connection?.id ?? null,
      state: connection?.state ?? null,
    };
  }
}
