import { describe, expect, it } from "vitest";
import { buildConversation } from "../client/conversation.ts";
import type { Note } from "../client/notes.ts";

function note(over: Partial<Note> & { id: string }): Note {
  return {
    seq: 1,
    sourceId: "book",
    author: { id: "u-local", name: "local" },
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

describe("buildConversation", () => {
  it("collects top-level notes as roots, oldest first", () => {
    const conv = buildConversation([
      note({ id: "b", createdAt: "2026-01-02T00:00:00.000Z" }),
      note({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }),
    ]);

    expect(conv.roots.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("nests replies under their parent, oldest first", () => {
    const conv = buildConversation([
      note({ id: "root" }),
      note({ id: "r2", parent: "root", createdAt: "2026-01-03T00:00:00.000Z" }),
      note({ id: "r1", parent: "root", createdAt: "2026-01-02T00:00:00.000Z" }),
    ]);

    expect(conv.roots.map((n) => n.id)).toEqual(["root"]);
    expect(conv.childrenOf("root").map((n) => n.id)).toEqual(["r1", "r2"]);
  });

  it("treats a reply whose parent is missing as a root", () => {
    const conv = buildConversation([note({ id: "orphan", parent: "gone" })]);

    expect(conv.roots.map((n) => n.id)).toEqual(["orphan"]);
    expect(conv.childrenOf("gone")).toEqual([]);
  });

  it("indexes notes by id and by seq", () => {
    const conv = buildConversation([note({ id: "a", seq: 7 })]);

    expect(conv.byId.get("a")?.seq).toBe(7);
    expect(conv.bySeq.get(7)?.id).toBe("a");
  });
});
