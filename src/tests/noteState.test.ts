import { describe, expect, it } from "vitest";
import type { Highlight } from "../client/highlights.ts";
import type { Note } from "../client/notes.ts";
import {
  addNote,
  addReply,
  editNote,
  emptyNoteState,
  rebindHighlight,
  removeNote,
  type NoteStamp,
  type NoteState,
} from "../server/noteState.ts";

// A deterministic stamp: ids count up (n1, n2, ...) and time is fixed unless set.
function fakeStamp(now = "2026-01-01T00:00:00.000Z"): NoteStamp {
  let n = 0;
  return { id: () => `id-${++n}`, now: () => now };
}

function highlight(id: string): Highlight {
  return {
    id,
    sourceId: "book",
    cfi: {
      type: "FragmentSelector",
      conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html",
      value: "cfi-1",
    },
    quote: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("addNote", () => {
  it("appends a stamped top-level note and increments the seq counter", () => {
    const next = addNote(emptyNoteState(), "book", "hello", [highlight("h1")], fakeStamp());

    expect(next.nextSeq).toBe(2);
    expect(next.notes).toHaveLength(1);
    const note = next.notes[0] as Note;
    expect(note).toMatchObject({
      id: "id-1",
      seq: 1,
      sourceId: "book",
      parent: null,
      body: "hello",
      version: 1,
      deletedAt: null,
      editedAt: null,
    });
    expect(note.highlights).toHaveLength(1);
  });
});

describe("addReply", () => {
  it("appends a reply pointing at its parent and carrying no highlights", () => {
    const stamp = fakeStamp();
    const base = addNote(emptyNoteState(), "book", "root", [highlight("h1")], stamp);

    const next = addReply(base, "book", "id-1", "a reply", stamp);

    expect(next.nextSeq).toBe(3);
    expect(next.notes).toHaveLength(2);
    const reply = next.notes[1] as Note;
    expect(reply).toMatchObject({ id: "id-2", seq: 2, parent: "id-1", body: "a reply" });
    expect(reply.highlights).toEqual([]);
  });
});

describe("editNote", () => {
  it("replaces the body, bumps the version, and stamps editedAt", () => {
    const base = addNote(emptyNoteState(), "book", "before", [], fakeStamp());

    const next = editNote(base, "id-1", "after", "2026-02-02T00:00:00.000Z");

    const note = next.notes[0] as Note;
    expect(note.body).toBe("after");
    expect(note.version).toBe(2);
    expect(note.editedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("leaves a deleted note untouched", () => {
    const base = addNote(emptyNoteState(), "book", "before", [], fakeStamp());
    const tombstoned: NoteState = {
      ...base,
      notes: [{ ...(base.notes[0] as Note), deletedAt: "2026-01-15T00:00:00.000Z" }],
    };

    const next = editNote(tombstoned, "id-1", "after", "2026-02-02T00:00:00.000Z");

    expect((next.notes[0] as Note).body).toBe("before");
    expect((next.notes[0] as Note).version).toBe(1);
  });
});

describe("rebindHighlight", () => {
  it("updates a single embedded highlight's cfi value", () => {
    const base = addNote(emptyNoteState(), "book", "n", [highlight("h1")], fakeStamp());

    const next = rebindHighlight(base, "id-1", "h1", "cfi-fresh");

    expect((next.notes[0] as Note).highlights[0]?.cfi.value).toBe("cfi-fresh");
  });
});

describe("removeNote", () => {
  const at = "2026-03-03T00:00:00.000Z";

  it("hard-deletes a note that has no children and is unreferenced", () => {
    const base = addNote(emptyNoteState(), "book", "lonely", [], fakeStamp());

    const next = removeNote(base, "id-1", at);

    expect(next.notes).toEqual([]);
  });

  it("tombstones a note that another note references via [[seq]]", () => {
    const stamp = fakeStamp();
    let state = addNote(emptyNoteState(), "book", "target", [highlight("h1")], stamp);
    state = addNote(state, "book", "see [[1]]", [], stamp);

    const next = removeNote(state, "id-1", at);

    const tomb = next.notes[0] as Note;
    expect(tomb.deletedAt).toBe(at);
    expect(tomb.body).toContain("deleted");
    expect(tomb.highlights).toEqual([]);
    expect(tomb.version).toBe(2);
  });

  it("tombstones a note that has replies", () => {
    const stamp = fakeStamp();
    let state = addNote(emptyNoteState(), "book", "root", [], stamp);
    state = addReply(state, "book", "id-1", "child", stamp);

    const next = removeNote(state, "id-1", at);

    expect(next.notes).toHaveLength(2);
    expect((next.notes[0] as Note).deletedAt).toBe(at);
  });
});
