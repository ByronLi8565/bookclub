import { describe, expect, it } from "vitest";
import { epubAnchor, type Highlight } from "../client/logic/notes/highlights.ts";
import type { Note, NoteAuthor } from "../shared/types/notes.ts";
import {
  addNote,
  addReply,
  editNote,
  emptyNoteState,
  rebindHighlight,
  removeNote,
  removeSourceNotes,
  type NoteStamp,
  type NoteState,
} from "../server/state/noteState.ts";

function fakeStamp(now = "2026-01-01T00:00:00.000Z"): NoteStamp {
  let n = 0;
  return { id: () => `id-${++n}`, now: () => now };
}

const ALICE: NoteAuthor = { id: "u-alice", name: "Alice" };
const BOB: NoteAuthor = { id: "u-bob", name: "Bob" };

function highlight(id: string): Highlight {
  return {
    id,
    sourceId: "book",
    anchor: epubAnchor("cfi-1"),
    quote: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("addNote", () => {
  it("appends a stamped top-level note and increments the seq counter", () => {
    const next = addNote(emptyNoteState(), "book", ALICE, "hello", [highlight("h1")], fakeStamp());

    expect(next.nextSeq).toBe(2);
    expect(next.notes).toHaveLength(1);
    const note = next.notes[0] as Note;
    expect(note).toMatchObject({
      id: "id-1",
      seq: 1,
      sourceId: "book",
      author: ALICE,
      parent: null,
      body: "hello",
      version: 1,
      deletedAt: null,
      editedAt: null,
    });
    expect(note.highlights).toHaveLength(1);
  });

  it("omits tags entirely for an untagged note but stores them when given", () => {
    const plain = addNote(emptyNoteState(), "book", ALICE, "hi", [], fakeStamp());
    expect(plain.notes[0]).not.toHaveProperty("tags");

    const tagged = addNote(emptyNoteState(), "book", ALICE, "> q", [], fakeStamp(), ["highlight"]);
    expect(tagged.notes[0]?.tags).toEqual(["highlight"]);
  });
});

describe("addReply", () => {
  it("appends a reply pointing at its parent and carrying no highlights", () => {
    const stamp = fakeStamp();
    const base = addNote(emptyNoteState(), "book", ALICE, "root", [highlight("h1")], stamp);

    const next = addReply(base, "book", BOB, "id-1", "a reply", stamp);

    expect(next.nextSeq).toBe(3);
    expect(next.notes).toHaveLength(2);
    const reply = next.notes[1] as Note;
    expect(reply).toMatchObject({
      id: "id-2",
      seq: 2,
      parent: "id-1",
      body: "a reply",
      author: BOB,
    });
    expect(reply.highlights).toEqual([]);
  });
});

describe("editNote", () => {
  it("replaces the body, bumps the version, and stamps editedAt for the author", () => {
    const base = addNote(emptyNoteState(), "book", ALICE, "before", [], fakeStamp());

    const next = editNote(base, "id-1", "after", "2026-02-02T00:00:00.000Z", ALICE.id);

    const note = next.notes[0] as Note;
    expect(note.body).toBe("after");
    expect(note.version).toBe(2);
    expect(note.editedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("refuses to edit another member's note (author-only)", () => {
    const base = addNote(emptyNoteState(), "book", ALICE, "before", [], fakeStamp());

    const next = editNote(base, "id-1", "after", "2026-02-02T00:00:00.000Z", BOB.id);

    expect(next.notes[0]).toBe(base.notes[0]);
    expect((next.notes[0] as Note).body).toBe("before");
  });

  it("leaves a deleted note untouched", () => {
    const base = addNote(emptyNoteState(), "book", ALICE, "before", [], fakeStamp());
    const tombstoned: NoteState = {
      ...base,
      notes: [{ ...(base.notes[0] as Note), deletedAt: "2026-01-15T00:00:00.000Z" }],
    };

    const next = editNote(tombstoned, "id-1", "after", "2026-02-02T00:00:00.000Z", ALICE.id);

    expect((next.notes[0] as Note).body).toBe("before");
    expect((next.notes[0] as Note).version).toBe(1);
  });
});

describe("rebindHighlight", () => {
  it("updates a single embedded highlight's anchor", () => {
    const base = addNote(emptyNoteState(), "book", ALICE, "n", [highlight("h1")], fakeStamp());

    const next = rebindHighlight(base, "id-1", "h1", epubAnchor("cfi-fresh"));

    expect((next.notes[0] as Note).highlights[0]?.anchor).toEqual(epubAnchor("cfi-fresh"));
  });
});

describe("removeNote", () => {
  const at = "2026-03-03T00:00:00.000Z";

  it("hard-deletes a note that has no children and is unreferenced", () => {
    const base = addNote(emptyNoteState(), "book", ALICE, "lonely", [], fakeStamp());

    const next = removeNote(base, "id-1", at, ALICE.id, false);

    expect(next.notes).toEqual([]);
  });

  it("refuses to delete another member's note when the caller is not the owner", () => {
    const base = addNote(emptyNoteState(), "book", ALICE, "lonely", [], fakeStamp());

    const next = removeNote(base, "id-1", at, BOB.id, false);

    expect(next).toBe(base);
  });

  it("lets the group owner delete anyone's note (moderation)", () => {
    const base = addNote(emptyNoteState(), "book", ALICE, "lonely", [], fakeStamp());

    const next = removeNote(base, "id-1", at, BOB.id, true);

    expect(next.notes).toEqual([]);
  });

  it("tombstones a note that another note references via [[seq]]", () => {
    const stamp = fakeStamp();
    let state = addNote(emptyNoteState(), "book", ALICE, "target", [highlight("h1")], stamp);
    state = addNote(state, "book", ALICE, "see [[1]]", [], stamp);

    const next = removeNote(state, "id-1", at, ALICE.id, false);

    const tomb = next.notes[0] as Note;
    expect(tomb.deletedAt).toBe(at);
    expect(tomb.body).toContain("deleted");
    expect(tomb.highlights).toEqual([]);
    expect(tomb.version).toBe(2);
  });

  it("tombstones a note that has replies", () => {
    const stamp = fakeStamp();
    let state = addNote(emptyNoteState(), "book", ALICE, "root", [], stamp);
    state = addReply(state, "book", ALICE, "id-1", "child", stamp);

    const next = removeNote(state, "id-1", at, ALICE.id, false);

    expect(next.notes).toHaveLength(2);
    expect((next.notes[0] as Note).deletedAt).toBe(at);
  });
});

describe("removeSourceNotes", () => {
  it("removes every note for the deleted book and preserves notes for other books", () => {
    const stamp = fakeStamp();
    let state = addNote(emptyNoteState(), "deleted-book", ALICE, "root", [], stamp);
    state = addReply(state, "deleted-book", BOB, "id-1", "reply", stamp);
    state = addNote(state, "kept-book", ALICE, "keep", [], stamp);

    const next = removeSourceNotes(state, "deleted-book");

    expect(next.notes.map((note) => note.body)).toEqual(["keep"]);
    expect(next.nextSeq).toBe(state.nextSeq);
  });
});
