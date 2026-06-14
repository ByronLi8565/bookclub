import { Agent, callable } from "agents";
import { monotonicFactory } from "ulidx";
import type { Highlight } from "../client/highlights.ts";
import type { Note } from "../client/notes.ts";
import { extractReferences } from "../client/references.ts";
import type { Env } from "./env.ts";

// Monotonic so notes created within the same millisecond inside this
// single-threaded durable object still get strictly increasing, sortable ids.
const ulid = monotonicFactory();

// The whole synced state for one Source (book). Clients render this broadcast
// state only; all writes go through the callable methods below, which run a
// read-modify-write inside the single-threaded durable object.
export interface NoteState {
  notes: Note[];
  // The next human-readable note number to hand out for this book. Monotonic and
  // never reused, so `[[n]]` references stay stable even across deletes.
  nextSeq: number;
}

// Keyed by sourceId (book hash): everyone with the same book annotates the same
// agent instance. The durable object is the source of truth for note identity,
// timestamps, and versions; clients send only the content of a change.
export class NoteAgent extends Agent<Env, NoteState> {
  initialState: NoteState = { notes: [], nextSeq: 1 };

  // Append a top-level note built from a painted highlight and a body. The
  // highlight is authored client-side (its anchor is a DOM artifact); the note
  // wrapper is stamped here.
  @callable()
  addNote(body: string, highlights: Highlight[]): void {
    const seq = this.state.nextSeq ?? 1;
    this.setState({
      notes: [...this.state.notes, this.build(seq, null, body, highlights)],
      nextSeq: seq + 1,
    });
  }

  // Append a reply: a note pointing at a parent note rather than the book, so it
  // carries no highlights of its own.
  @callable()
  addReply(parent: string, body: string): void {
    const seq = this.state.nextSeq ?? 1;
    this.setState({
      notes: [...this.state.notes, this.build(seq, parent, body, [])],
      nextSeq: seq + 1,
    });
  }

  // Last-write-wins edit of a note's body; bumps version and stamps editedAt.
  @callable()
  editNote(id: string, body: string): void {
    this.setNotes(
      this.state.notes.map((note) =>
        note.id === id && note.deletedAt === null
          ? { ...note, body, editedAt: new Date().toISOString(), version: note.version + 1 }
          : note,
      ),
    );
  }

  @callable()
  removeNote(id: string): void {
    const target = this.state.notes.find((note) => note.id === id);
    if (!target) return;

    // A note is only hard-deleted when nothing depends on it: no replies and no
    // `[[seq]]` references in any other note. Otherwise it becomes a tombstone,
    // so threads stay intact and references never dangle. (No tombstone GC: a
    // tombstone is not reclaimed if its last dependent later disappears.)
    const hasChildren = this.state.notes.some((note) => note.parent === id);
    const isReferenced = this.state.notes.some(
      (note) => note.id !== id && extractReferences(note.body).includes(target.seq),
    );
    if (!hasChildren && !isReferenced) {
      this.setNotes(this.state.notes.filter((note) => note.id !== id));
      return;
    }

    const deletedAt = new Date().toISOString();
    const deletedAtLabel = new Date(deletedAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    this.setNotes(
      this.state.notes.map((note) =>
        note.id === id
          ? {
              ...note,
              body: `*This note was deleted on ${deletedAtLabel}*`,
              highlights: [],
              editedAt: deletedAt,
              deletedAt,
              version: note.version + 1,
            }
          : note,
      ),
    );
  }

  // Rebind a single embedded highlight's cfi after a client re-located it.
  @callable()
  rebindHighlight(noteId: string, highlightId: string, cfiValue: string): void {
    this.setNotes(
      this.state.notes.map((note) =>
        note.id === noteId
          ? {
              ...note,
              highlights: note.highlights.map((h) =>
                h.id === highlightId ? { ...h, cfi: { ...h.cfi, value: cfiValue } } : h,
              ),
            }
          : note,
      ),
    );
  }

  // Replace the note list while preserving the seq counter.
  private setNotes(notes: Note[]): void {
    this.setState({ notes, nextSeq: this.state.nextSeq ?? 1 });
  }

  // Stamp the server-authored fields of a new note. sourceId is the agent's own
  // name (the book hash), so every note here belongs to the same Source.
  private build(seq: number, parent: string | null, body: string, highlights: Highlight[]): Note {
    return {
      id: ulid(),
      seq,
      sourceId: this.name,
      author: "local",
      parent,
      body,
      highlights,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      version: 1,
    };
  }
}
