import { describe, expect, it } from "vitest";
import {
  noteImageBlock,
  noteImageIds,
  parseNoteImageBlock,
  removeNoteImageReferences,
  unreferencedImageIds,
} from "../shared/notes/images.ts";
import type { Note } from "../shared/types/notes.ts";

const A = "01JH0000000000000000000000";
const B = "01JH0000000000000000000001";

function note(id: string, body: string): Note {
  return {
    id,
    seq: 1,
    sourceId: "source",
    author: { id: "author", name: "Author" },
    parent: null,
    body,
    highlights: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    version: 1,
  };
}

describe("note images", () => {
  it("finds image blocks but not inline lookalikes", () => {
    expect([...noteImageIds(`text\n\n[[image:${A}]]\n\ninline [[image:${B}]]`)]).toEqual([A]);
  });

  it("only removes images no longer referenced by any note", () => {
    const before = [note("one", `[[image:${A}]]`), note("two", `[[image:${A}]]\n\n[[image:${B}]]`)];
    const after = [note("one", `[[image:${A}]]`)];
    expect(unreferencedImageIds(before, after)).toEqual([B]);
  });

  it("removes every matching image block without changing other blocks", () => {
    const body = `first\n\n[[image:${A}]]\n\nsecond\n\n[[image:${A}:50]]\n\n[[image:${B}]]`;
    expect(removeNoteImageReferences(body, A)).toBe(`first\n\nsecond\n\n[[image:${B}]]`);
  });

  it("round-trips display widths while preserving legacy 100% blocks", () => {
    expect(parseNoteImageBlock(`[[image:${A}]]`)).toEqual({ id: A, width: 100 });
    expect(parseNoteImageBlock(`[[image:${A}:150]]`)).toEqual({ id: A, width: 100 });
    expect(parseNoteImageBlock(`[[image:${A}:1]]`)).toEqual({ id: A, width: 25 });
    expect(parseNoteImageBlock(`[[image:${A}:999]]`)).toEqual({ id: A, width: 100 });
    expect(noteImageBlock({ id: A, width: 65 })).toBe(`[[image:${A}:65]]`);
    expect(noteImageBlock({ id: A, width: 100 })).toBe(`[[image:${A}]]`);
  });
});
