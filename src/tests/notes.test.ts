import { describe, expect, it } from "vitest";
import { noteSnippet, renderNoteBody, type Note } from "../client/notes.ts";

function note(over: Partial<Note>): Note {
  return {
    id: "id",
    seq: 1,
    sourceId: "book",
    author: "local",
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
});
