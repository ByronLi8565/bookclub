import type { Note } from "../types/notes.ts";

const IMAGE_BLOCK_PATTERN = /^\[\[image:([0-9A-HJKMNP-TV-Z]{26})(?::(\d{1,3}))?\]\]$/u;

export const MIN_NOTE_IMAGE_WIDTH = 25;
export const MAX_NOTE_IMAGE_WIDTH = 100;
export const DEFAULT_NOTE_IMAGE_WIDTH = 100;

export interface NoteImageBlock {
  id: string;
  width: number;
}

export function clampNoteImageWidth(width: number): number {
  return Math.min(MAX_NOTE_IMAGE_WIDTH, Math.max(MIN_NOTE_IMAGE_WIDTH, Math.round(width)));
}

export function parseNoteImageBlock(block: string): NoteImageBlock | null {
  const match = IMAGE_BLOCK_PATTERN.exec(block.trim());
  const id = match?.[1];
  if (!id) return null;
  const rawWidth = match[2];
  return { id, width: rawWidth ? clampNoteImageWidth(Number(rawWidth)) : DEFAULT_NOTE_IMAGE_WIDTH };
}

export function noteImageBlock(image: NoteImageBlock): string {
  const width = clampNoteImageWidth(image.width);
  return width === DEFAULT_NOTE_IMAGE_WIDTH
    ? `[[image:${image.id}]]`
    : `[[image:${image.id}:${width}]]`;
}

export function noteImageIds(body: string): Set<string> {
  const ids = new Set<string>();
  for (const raw of body.split(/\n{2,}/u)) {
    const image = parseNoteImageBlock(raw);
    if (image) ids.add(image.id);
  }
  return ids;
}

export function removeNoteImageReferences(body: string, imageId: string): string {
  return body
    .split(/\n{2,}/u)
    .filter((block) => parseNoteImageBlock(block)?.id !== imageId)
    .join("\n\n");
}

export function unreferencedImageIds(before: Note[], after: Note[]): string[] {
  const beforeIds = new Set(before.flatMap((note) => [...noteImageIds(note.body)]));
  const afterIds = new Set(after.flatMap((note) => [...noteImageIds(note.body)]));
  return [...beforeIds].filter((id) => !afterIds.has(id));
}
