import type { Note } from "../../shared/types/notes.ts";
import { noteSnippet } from "./render.ts";

export interface Conversation {
  roots: Note[];
  childrenOf: (id: string) => Note[];
  byId: Map<string, Note>;
  bySeq: Map<number, Note>;
}

// Which notes a view wants to show. `"all"` spans every book the group reads
// (per the group-global model in ADR-0002); a list restricts to those sources.
export interface NoteSelection {
  sources: "all" | readonly string[];
}

// The set of notes a view should display, decoupled from any single open book.
export function selectNotes(notes: Note[], selection: NoteSelection): Note[] {
  if (selection.sources === "all") return notes;
  const wanted = new Set(selection.sources);
  return notes.filter((n) => wanted.has(n.sourceId));
}

// The group-global `[[n]]` reference space: every seq that can be linked and the
// snippet shown for it. Derived from the full note set so references resolve the
// same way in any view, regardless of which notes are currently selected.
export interface ReferenceSpace {
  validSeqs: Set<number>;
  refs: Map<number, string>;
}

export function referenceSpace(notes: Note[]): ReferenceSpace {
  return {
    validSeqs: new Set(notes.map((n) => n.seq)),
    refs: new Map(notes.map((n) => [n.seq, noteSnippet(n)] as const)),
  };
}

const byCreatedAt = (a: Note, b: Note): number => a.createdAt.localeCompare(b.createdAt);

export function buildConversation(notes: Note[]): Conversation {
  const byId = new Map(notes.map((n) => [n.id, n] as const));
  const bySeq = new Map(notes.map((n) => [n.seq, n] as const));

  const childrenMap = new Map<string, Note[]>();
  for (const note of notes) {
    if (note.parent !== null && byId.has(note.parent)) {
      const siblings = childrenMap.get(note.parent) ?? [];
      siblings.push(note);
      childrenMap.set(note.parent, siblings);
    }
  }
  for (const siblings of childrenMap.values()) siblings.sort(byCreatedAt);

  const roots = notes.filter((n) => n.parent === null || !byId.has(n.parent)).toSorted(byCreatedAt);

  return { roots, childrenOf: (id) => childrenMap.get(id) ?? [], byId, bySeq };
}
