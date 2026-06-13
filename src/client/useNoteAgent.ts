import { useAgent } from "agents/react";
import type { NoteAgent, NoteState } from "../server/NoteAgent.ts";
import type { Highlight } from "./highlights.ts";
import type { Note } from "./notes.ts";

// The synced notes for the open book plus the mutation calls that write them.
// Mutations are fire-and-forget: the durable object broadcasts the new state,
// which arrives as a fresh `notes` value on the next render.
export interface NoteSync {
  notes: Note[];
  addNote: (body: string, highlights: Highlight[]) => void;
  addReply: (parent: string, body: string) => void;
  editNote: (id: string, body: string) => void;
  removeNote: (id: string) => void;
  rebindHighlight: (noteId: string, highlightId: string, cfiValue: string) => void;
}

// Connect to the per-book NoteAgent durable object (one instance per sourceId)
// over a websocket and expose its live state. With no book open we park the
// connection on a throwaway "idle" instance whose empty state we ignore, so the
// hook count stays stable across file picks.
export function useNoteAgent(sourceId: string | null): NoteSync {
  const agent = useAgent<NoteAgent, NoteState>({ agent: "note-agent", name: sourceId ?? "idle" });
  const { stub } = agent;
  const fire = (p: Promise<unknown>) =>
    void p.catch((error: unknown) => console.error("note agent call failed", error));

  return {
    notes: sourceId ? (agent.state?.notes ?? []) : [],
    addNote: (body, highlights) => fire(stub.addNote(body, highlights)),
    addReply: (parent, body) => fire(stub.addReply(parent, body)),
    editNote: (id, body) => fire(stub.editNote(id, body)),
    removeNote: (id) => fire(stub.removeNote(id)),
    rebindHighlight: (noteId, highlightId, cfiValue) =>
      fire(stub.rebindHighlight(noteId, highlightId, cfiValue)),
  };
}
