import { Agent, callable } from "agents";
import { monotonicFactory } from "ulidx";
import type { Highlight } from "../client/highlights.ts";
import type { Note } from "../client/notes.ts";
import type { Env } from "./env.ts";

// Monotonic so notes created within the same millisecond inside this
// single-threaded durable object still get strictly increasing, sortable ids.
const ulid = monotonicFactory();

// The whole synced state for one Source (book). Clients render this broadcast
// state only; all writes go through the callable methods below, which run a
// read-modify-write inside the single-threaded durable object.
export interface NoteState {
  notes: Note[];
}

// Keyed by sourceId (book hash): everyone with the same book annotates the same
// agent instance. The durable object is the source of truth for note identity,
// timestamps, and versions; clients send only the content of a change.
export class NoteAgent extends Agent<Env, NoteState> {
  initialState: NoteState = { notes: [] };

  // Append a top-level note built from a painted highlight and a body. The
  // highlight is authored client-side (its anchor is a DOM artifact); the note
  // wrapper is stamped here.
  @callable()
  addNote(body: string, highlights: Highlight[]): void {
    this.setState({ notes: [...this.state.notes, this.build(null, body, highlights)] });
  }

  // Append a reply: a note pointing at a parent note rather than the book, so it
  // carries no highlights of its own.
  @callable()
  addReply(parent: string, body: string): void {
    this.setState({ notes: [...this.state.notes, this.build(parent, body, [])] });
  }

  // Last-write-wins edit of a note's body; bumps version and stamps editedAt.
  @callable()
  editNote(id: string, body: string): void {
    this.setState({
      notes: this.state.notes.map((note) =>
        note.id === id
          ? { ...note, body, editedAt: new Date().toISOString(), version: note.version + 1 }
          : note,
      ),
    });
  }

  @callable()
  removeNote(id: string): void {
    this.setState({ notes: this.state.notes.filter((note) => note.id !== id) });
  }

  // Rebind a single embedded highlight's cfi after a client re-located it.
  @callable()
  rebindHighlight(noteId: string, highlightId: string, cfiValue: string): void {
    this.setState({
      notes: this.state.notes.map((note) =>
        note.id === noteId
          ? {
              ...note,
              highlights: note.highlights.map((h) =>
                h.id === highlightId ? { ...h, cfi: { ...h.cfi, value: cfiValue } } : h,
              ),
            }
          : note,
      ),
    });
  }

  // Stamp the server-authored fields of a new note. sourceId is the agent's own
  // name (the book hash), so every note here belongs to the same Source.
  private build(parent: string | null, body: string, highlights: Highlight[]): Note {
    return {
      id: ulid(),
      sourceId: this.name,
      author: "local",
      parent,
      body,
      highlights,
      createdAt: new Date().toISOString(),
      editedAt: null,
      version: 1,
    };
  }
}
