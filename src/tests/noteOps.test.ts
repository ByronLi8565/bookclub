import { describe, expect, it } from "vitest";
import { epubAnchor, type Highlight, type NoteOp } from "../shared/types/notes.ts";
import {
  applyOperations,
  emptyNoteState,
  type ApplyContext,
  type NoteState,
} from "../shared/notes/noteState.ts";

const alice: ApplyContext = { author: { id: "u-alice", name: "Alice" }, isOwner: false };
const bob: ApplyContext = { author: { id: "u-bob", name: "Bob" }, isOwner: false };
const ownerBob: ApplyContext = { author: { id: "u-bob", name: "Bob" }, isOwner: true };

function highlight(id: string): Highlight {
  return {
    id,
    sourceId: "src",
    anchor: epubAnchor("cfi"),
    quote: { type: "TextQuoteSelector", exact: "x", prefix: "", suffix: "" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function addOp(
  opId: string,
  noteId: string,
  body: string,
  at = "2026-01-01T00:00:00.000Z",
): NoteOp {
  return { opId, kind: "add", noteId, sourceId: "src", body, highlights: [], createdAt: at };
}

describe("applyOperations", () => {
  it("assigns server seq and applies an add", () => {
    const r = applyOperations(emptyNoteState(), [addOp("op1", "n1", "hello")], alice);
    expect(r.state.notes).toHaveLength(1);
    expect(r.state.notes[0]).toMatchObject({
      id: "n1",
      seq: 1,
      body: "hello",
      author: alice.author,
    });
    expect(r.appliedOpIds).toEqual(["op1"]);
    expect(r.rejectedOps).toEqual([]);
  });

  it("stamps author from context, not payload", () => {
    // Even though Bob flushes the op, identity comes from the connection.
    const r = applyOperations(emptyNoteState(), [addOp("op1", "n1", "hi")], bob);
    expect(r.state.notes[0]?.author).toEqual(bob.author);
  });

  it("carries an add op's tags onto the committed note", () => {
    const op: NoteOp = {
      opId: "op1",
      kind: "add",
      noteId: "n1",
      sourceId: "src",
      body: "> quote",
      highlights: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      tags: ["highlight"],
    };
    const r = applyOperations(emptyNoteState(), [op], alice);
    expect(r.state.notes[0]?.tags).toEqual(["highlight"]);
  });

  describe("idempotent replay (no data loss / no duplication)", () => {
    it("re-applying the same add does not duplicate or consume a new seq", () => {
      const once = applyOperations(emptyNoteState(), [addOp("op1", "n1", "hi")], alice);
      const twice = applyOperations(once.state, [addOp("op1", "n1", "hi")], alice);
      expect(twice.state.notes).toHaveLength(1);
      expect(twice.state.nextSeq).toBe(2);
      // Still reported applied so the client prunes it from its queue.
      expect(twice.appliedOpIds).toEqual(["op1"]);
    });

    it("dedupes by stable note id even if the op id ring forgot it", () => {
      const once = applyOperations(emptyNoteState(), [addOp("op1", "n1", "hi")], alice);
      const forgot: NoteState = { ...once.state, appliedOpIds: [] };
      const replay = applyOperations(forgot, [addOp("op1b", "n1", "hi")], alice);
      expect(replay.state.notes).toHaveLength(1);
    });

    it("applies a full batch atomically and in order", () => {
      const r = applyOperations(
        emptyNoteState(),
        [
          addOp("op1", "n1", "root"),
          {
            opId: "op2",
            kind: "reply",
            noteId: "n2",
            sourceId: "src",
            parent: "n1",
            body: "child",
            createdAt: "2026-01-01T00:01:00.000Z",
          },
        ],
        alice,
      );
      expect(r.state.notes).toHaveLength(2);
      expect(r.state.notes[1]).toMatchObject({ id: "n2", parent: "n1", seq: 2 });
    });
  });

  describe("last-write-wins edits", () => {
    it("applies a newer edit", () => {
      const base = applyOperations(emptyNoteState(), [addOp("op1", "n1", "v1")], alice).state;
      const r = applyOperations(
        base,
        [{ opId: "op2", kind: "edit", noteId: "n1", body: "v2", at: "2026-01-02T00:00:00.000Z" }],
        alice,
      );
      expect(r.state.notes[0]?.body).toBe("v2");
    });

    it("silently supersedes a stale edit without error or change", () => {
      const base = applyOperations(
        emptyNoteState(),
        [addOp("op1", "n1", "v1", "2026-01-05T00:00:00.000Z")],
        alice,
      ).state;
      const r = applyOperations(
        base,
        [
          {
            opId: "op2",
            kind: "edit",
            noteId: "n1",
            body: "stale",
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
        alice,
      );
      expect(r.state.notes[0]?.body).toBe("v1");
      expect(r.rejectedOps).toEqual([]); // pruned, not surfaced
      expect(r.appliedOpIds).toEqual(["op2"]);
    });

    it("rejects an edit by a non-author and surfaces it", () => {
      const base = applyOperations(emptyNoteState(), [addOp("op1", "n1", "v1")], alice).state;
      const r = applyOperations(
        base,
        [{ opId: "op2", kind: "edit", noteId: "n1", body: "hack", at: "2026-02-01T00:00:00.000Z" }],
        bob,
      );
      expect(r.state.notes[0]?.body).toBe("v1");
      expect(r.rejectedOps).toEqual([{ opId: "op2", reason: "forbidden" }]);
    });
  });

  describe("vanished targets", () => {
    it("treats removing an already-gone note as a no-op", () => {
      const r = applyOperations(
        emptyNoteState(),
        [{ opId: "op1", kind: "remove", noteId: "ghost", at: "2026-01-01T00:00:00.000Z" }],
        alice,
      );
      expect(r.rejectedOps).toEqual([]);
      expect(r.appliedOpIds).toEqual(["op1"]);
    });

    it("rejects editing a deleted note (surfaced, not silent)", () => {
      let s = applyOperations(
        emptyNoteState(),
        [addOp("op1", "n1", "v1"), addOp("op2", "n2", "ref")],
        alice,
      ).state;
      // Reference n1 from n2 so removal tombstones rather than hard-deletes.
      s = applyOperations(
        s,
        [
          {
            opId: "opr",
            kind: "edit",
            noteId: "n2",
            body: "see @1",
            at: "2026-01-02T00:00:00.000Z",
          },
        ],
        alice,
      ).state;
      s = applyOperations(
        s,
        [{ opId: "opd", kind: "remove", noteId: "n1", at: "2026-01-03T00:00:00.000Z" }],
        alice,
      ).state;
      const r = applyOperations(
        s,
        [{ opId: "ope", kind: "edit", noteId: "n1", body: "late", at: "2026-01-04T00:00:00.000Z" }],
        alice,
      );
      expect(r.rejectedOps).toEqual([{ opId: "ope", reason: "gone" }]);
    });
  });

  describe("owner moderation", () => {
    it("lets a group owner remove another member's note", () => {
      const base = applyOperations(emptyNoteState(), [addOp("op1", "n1", "v1")], alice).state;
      const r = applyOperations(
        base,
        [{ opId: "op2", kind: "remove", noteId: "n1", at: "2026-02-01T00:00:00.000Z" }],
        ownerBob,
      );
      expect(r.state.notes).toHaveLength(0);
      expect(r.rejectedOps).toEqual([]);
    });
  });

  describe("rebind", () => {
    it("no-ops a rebind for a missing highlight", () => {
      const base = applyOperations(
        emptyNoteState(),
        [
          {
            opId: "op1",
            kind: "add",
            noteId: "n1",
            sourceId: "src",
            body: "b",
            highlights: [highlight("h1")],
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        alice,
      ).state;
      const r = applyOperations(
        base,
        [
          {
            opId: "op2",
            kind: "rebind",
            noteId: "n1",
            highlightId: "missing",
            anchor: epubAnchor("new"),
          },
        ],
        alice,
      );
      expect(r.state.notes[0]?.highlights[0]?.anchor).toEqual(epubAnchor("cfi"));
      expect(r.appliedOpIds).toEqual(["op2"]);
    });
  });
});
