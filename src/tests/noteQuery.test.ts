import { describe, expect, it } from "vitest";
import {
  filterConversation,
  matchesNoteQuery,
  type NoteQuery,
} from "../client/logic/notes/noteQuery.ts";
import type { Note } from "../shared/types/notes.ts";

function note(over: Partial<Note> & { id: string }): Note {
  return {
    seq: 1,
    sourceId: "book-1",
    author: { id: "alice", name: "Alice" },
    parent: null,
    body: "",
    highlights: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    version: 1,
    ...over,
  };
}

const all = { kind: "all-books" } as const;

function query(terms: NoteQuery["terms"], mode: NoteQuery["mode"] = "all"): NoteQuery {
  return { terms, mode };
}

describe("note queries", () => {
  it("combines freeform tags and derived properties", () => {
    const candidate = note({ id: "n", sourceId: "book-2", tags: ["question"] });
    expect(
      matchesNoteQuery(
        candidate,
        query([
          { kind: "tag", value: "question", negated: false },
          { kind: "property", property: "book", value: "book-2", negated: false },
          { kind: "property", property: "author", value: "alice", negated: false },
          { kind: "property", property: "type", value: "note", negated: false },
        ]),
      ),
    ).toBe(true);
  });

  it("supports any matching and exclusions", () => {
    const candidate = note({ id: "n", tags: ["thought", "resolved"] });
    expect(
      matchesNoteQuery(
        candidate,
        query(
          [
            { kind: "tag", value: "question", negated: false },
            { kind: "tag", value: "thought", negated: false },
          ],
          "any",
        ),
      ),
    ).toBe(true);
    expect(
      matchesNoteQuery(candidate, query([{ kind: "tag", value: "resolved", negated: true }])),
    ).toBe(false);
  });

  it("shows a matching reply with ancestors and descendants but not sibling branches", () => {
    const notes = [
      note({ id: "root" }),
      note({ id: "match", parent: "root", tags: ["question"] }),
      note({ id: "child", parent: "match" }),
      note({ id: "sibling", parent: "root" }),
    ];
    const result = filterConversation(
      notes,
      all,
      query([{ kind: "tag", value: "question", negated: false }]),
    );

    expect([...result.conversation.byId.keys()]).toEqual(["root", "match", "child"]);
    expect(result.matchingIds).toEqual(new Set(["match"]));
    expect(result.contextIds).toEqual(new Set(["root", "child"]));
  });

  it("uses source identity for current-book scope", () => {
    const result = filterConversation(
      [note({ id: "one" }), note({ id: "two", sourceId: "book-2" })],
      { kind: "current-book", sourceId: "book-2" },
      query([]),
    );
    expect([...result.conversation.byId.keys()]).toEqual(["two"]);
  });
});
