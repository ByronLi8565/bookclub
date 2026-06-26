import { useAgent } from "agents/react";
import { useState } from "react";
import type { Note } from "../../shared/types/notes.ts";
import type { NoteAgent, NoteState, OnlinePeer } from "../../server/agents/NoteAgent.ts";
import type { Highlight, HighlightAnchor } from "./highlights.ts";
import { spawnToast } from "../ui/shared/toast/toastStore.ts";

export type { OnlinePeer } from "../../server/agents/NoteAgent.ts";

export interface NoteSync {
  notes: Note[];
  notesReady: boolean;
  syncStatus: "syncing" | "online" | "offline";
  online: OnlinePeer[];
  addNote: (sourceId: string, body: string, highlights: Highlight[]) => boolean;
  addReply: (sourceId: string, parent: string, body: string) => boolean;
  editNote: (id: string, body: string) => boolean;
  removeNote: (id: string) => boolean;
  rebindHighlight: (noteId: string, highlightId: string, anchor: HighlightAnchor) => boolean;
}

export function useNoteAgent(groupId: string | null): NoteSync {
  const [presence, setPresence] = useState<{ groupId: string | null; online: OnlinePeer[] }>({
    groupId,
    online: [],
  });
  if (presence.groupId !== groupId) setPresence({ groupId, online: [] });
  const agent = useAgent<NoteAgent, NoteState>({
    agent: "note-agent",
    name: groupId ?? "idle",
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type?: string; users?: OnlinePeer[] };
        if (msg.type === "presence" && msg.users) setPresence({ groupId, online: msg.users });
      } catch {}
    },
  });

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
    notesReady: groupId ? agent.state !== undefined : true,
    online: groupId && presence.groupId === groupId ? presence.online : [],
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
    rebindHighlight: (noteId, highlightId, anchor) =>
      fire(() => stub.rebindHighlight(noteId, highlightId, anchor)),
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
