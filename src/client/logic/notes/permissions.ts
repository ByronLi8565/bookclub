import type { Note } from "../../../shared/types/notes.ts";

export interface NoteViewer {
  userId: string;
  isOwner: boolean;
}
// Only its author can edit a note

export function canEditNote(note: Note, viewer: NoteViewer): boolean {
  return note.author.id === viewer.userId;
}
// Only its author, or the group owner moderating can delete a note

export function canDeleteNote(note: Note, viewer: NoteViewer): boolean {
  return note.author.id === viewer.userId || viewer.isOwner;
}
