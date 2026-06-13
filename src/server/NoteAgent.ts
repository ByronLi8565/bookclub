import { Agent } from "agents";
import type { Note } from "../client/notes.ts";
import type { Env } from "./env.ts";

// The whole synced state for one Source (book). Clients render this broadcast
// state only; all writes go through the callable methods below, which run a
// read-modify-write inside the single-threaded durable object.
export interface NoteState {
  notes: Note[];
}

// Keyed by sourceId (book hash): everyone with the same book annotates the same
// agent instance. Callable mutations land in step 2.
export class NoteAgent extends Agent<Env, NoteState> {
  initialState: NoteState = { notes: [] };
}
