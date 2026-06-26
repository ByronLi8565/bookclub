import type { Highlight, Note } from "../../../shared/types/notes.ts";
import { noteSnippet } from "./format.ts";

export interface Conversation {
  roots: Note[];
  childrenOf: (id: string) => Note[];
  byId: Map<string, Note>;
  bySeq: Map<number, Note>;
}

export interface NoteSelection {
  sources: "all" | readonly string[];
}

// The set of notes a view should display
export function selectNotes(notes: Note[], selection: NoteSelection): Note[] {
  if (selection.sources === "all") return notes;
  const wanted = new Set(selection.sources);
  return notes.filter((n) => wanted.has(n.sourceId));
}

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
export function effectiveHighlight(note: Note, byId: Map<string, Note>): Highlight | null {
  const seen = new Set<string>();
  let current: Note | undefined = note;
  while (current && !seen.has(current.id)) {
    if (current.highlights[0]) return current.highlights[0];
    seen.add(current.id);
    current = current.parent === null ? undefined : byId.get(current.parent);
  }
  return null;
}
