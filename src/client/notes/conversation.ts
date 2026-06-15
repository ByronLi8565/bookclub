import type { Note } from "../../shared/types/notes.ts";

export interface Conversation {
  roots: Note[];
  childrenOf: (id: string) => Note[];
  byId: Map<string, Note>;
  bySeq: Map<number, Note>;
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
