import { useAgent } from "agents/react";
import type { NoteAgent, NoteState } from "../server/NoteAgent.ts";
import type { Highlight } from "./highlights.ts";
import type { Note } from "./notes.ts";
import { spawnToast } from "./ui/toast.tsx";

// The synced notes for the open book plus the mutation calls that write them.
// Mutations are fire-and-forget: the durable object broadcasts the new state,
// which arrives as a fresh `notes` value on the next render.
export interface NoteSync {
  notes: Note[];
  addNote: (body: string, highlights: Highlight[]) => boolean;
  addReply: (parent: string, body: string) => boolean;
  editNote: (id: string, body: string) => boolean;
  removeNote: (id: string) => boolean;
  rebindHighlight: (noteId: string, highlightId: string, cfiValue: string) => boolean;
}

// Connect to the per-book NoteAgent durable object (one instance per sourceId)
// over a websocket and expose its live state. With no book open we park the
// connection on a throwaway "idle" instance whose empty state we ignore, so the
// hook count stays stable across file picks.
export function useNoteAgent(sourceId: string | null): NoteSync {
  const agent = useAgent<NoteAgent, NoteState>({ agent: "note-agent", name: sourceId ?? "idle" });
  const { stub } = agent;
  const fire = (call: () => Promise<unknown>) => {
    if (agent.readyState !== agent.OPEN) {
      spawnToast("Offline", "Couldn't save that change. Reconnect and try again.", {
        type: "error",
        durationMs: 4000,
      });
      return false;
    }

    void call().catch((error: unknown) => {
      console.error("note agent call failed", error);
    });
    return true;
  };

  return {
    notes: sourceId ? (agent.state?.notes ?? []) : [],
    addNote: (body, highlights) => fire(() => stub.addNote(body, highlights)),
    addReply: (parent, body) => fire(() => stub.addReply(parent, body)),
    editNote: (id, body) => fire(() => stub.editNote(id, body)),
    removeNote: (id) => fire(() => stub.removeNote(id)),
    rebindHighlight: (noteId, highlightId, cfiValue) =>
      fire(() => stub.rebindHighlight(noteId, highlightId, cfiValue)),
  };
}
