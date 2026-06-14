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
  syncStatus: "syncing" | "online" | "offline";
  addNote: (sourceId: string, body: string, highlights: Highlight[]) => boolean;
  addReply: (sourceId: string, parent: string, body: string) => boolean;
  editNote: (id: string, body: string) => boolean;
  removeNote: (id: string) => boolean;
  rebindHighlight: (noteId: string, highlightId: string, cfiValue: string) => boolean;
}

// Connect to the per-group NoteAgent durable object (one instance per groupId,
// decision 6) over a websocket and expose its live state. The notes for all of a
// group's books live in this one instance, each tagged with its sourceId. With
// no group open we park the connection on a throwaway "idle" instance whose
// empty state we ignore, so the hook count stays stable.
export function useNoteAgent(groupId: string | null): NoteSync {
  const agent = useAgent<NoteAgent, NoteState>({ agent: "note-agent", name: groupId ?? "idle" });
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
      spawnToast("Save failed", "The note service rejected that change. Try again.", {
        type: "error",
        durationMs: 4000,
      });
    });
    return true;
  };

  return {
    notes: groupId ? (agent.state?.notes ?? []) : [],
    syncStatus: syncStatus(
      groupId,
      agent.readyState,
      agent.CONNECTING,
      agent.OPEN,
      agent.identified,
    ),
    addNote: (sourceId, body, highlights) => fire(() => stub.addNote(sourceId, body, highlights)),
    addReply: (sourceId, parent, body) => fire(() => stub.addReply(sourceId, parent, body)),
    editNote: (id, body) => fire(() => stub.editNote(id, body)),
    removeNote: (id) => fire(() => stub.removeNote(id)),
    rebindHighlight: (noteId, highlightId, cfiValue) =>
      fire(() => stub.rebindHighlight(noteId, highlightId, cfiValue)),
  };
}

function syncStatus(
  groupId: string | null,
  readyState: number,
  connectingState: number,
  openState: number,
  identified: boolean,
): NoteSync["syncStatus"] {
  if (!groupId) return "syncing";
  if (readyState === openState) return identified ? "online" : "syncing";
  if (readyState === connectingState) return "syncing";
  return "offline";
}
