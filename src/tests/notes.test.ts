import { describe, expect, it } from "vitest";
import { HIGHLIGHT_TAG, type Note } from "../shared/types/notes.ts";
import { renderNoteBody } from "../client/logic/notes/renderHtml.ts";
import { blockquote, highlightMark, noteSnippet, noteTitle } from "../client/logic/notes/format.ts";

function note(over: Partial<Note>): Note {
  return {
    id: "id",
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

describe("renderNoteBody", () => {
  it("wraps a paragraph and renders bold and italic", () => {
    expect(renderNoteBody("hello **bold** and *it*")).toBe(
      "<p>hello <strong>bold</strong> and <em>it</em></p>",
    );
  });

  it("renders a run of > lines as a single blockquote", () => {
    expect(renderNoteBody("> a\n> b")).toBe("<blockquote>a b</blockquote>");
  });

  it("escapes HTML in the body", () => {
    expect(renderNoteBody("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });

  it("renders a resolvable [[n]] as a chip and leaves an unknown one as text", () => {
    const html = renderNoteBody("see [[1]] and [[9]]", new Map([[1, "the first note"]]));
    expect(html).toContain('data-seq="1"');
    expect(html).toContain("[[9]]");
  });
});

describe("noteSnippet", () => {
  it("renders references as #n and strips markdown", () => {
    expect(noteSnippet(note({ body: "see [[2]] **here**" }))).toBe("see #2 here");
  });

  it("falls back to the anchored quote, then the bare seq", () => {
    expect(noteSnippet(note({ seq: 5 }))).toBe("#5");
  });

  it("strips the == wrapper from a highlight body", () => {
    expect(noteSnippet(note({ body: "==Call me Ishmael.==" }))).toBe("Call me Ishmael.");
  });
});

describe("noteTitle", () => {
  it("says posted for a plain top-level note", () => {
    expect(noteTitle(note({ author: { id: "u", name: "angela.huo" } }))).toMatch(
      /^angela\.huo posted /u,
    );
  });

  it("says highlighted for a note tagged as a highlight", () => {
    const title = noteTitle(
      note({ author: { id: "u", name: "angela.huo" }, tags: [HIGHLIGHT_TAG] }),
    );
    expect(title).toMatch(/^angela\.huo highlighted /u);
  });

  it("says replied for a reply even when tagged (replies are never highlights)", () => {
    expect(noteTitle(note({ parent: "root", tags: [HIGHLIGHT_TAG] }))).toMatch(/ replied /u);
  });
});

describe("blockquote", () => {
  it("prefixes with > and collapses inner whitespace", () => {
    expect(blockquote("  Call me\n  Ishmael.  ")).toBe("> Call me Ishmael.");
  });
});

describe("highlightMark", () => {
  it("wraps the passage in == so it renders as a highlight, collapsing whitespace", () => {
    expect(highlightMark("  Call me\n  Ishmael.  ")).toBe("==Call me Ishmael.==");
  });
});
