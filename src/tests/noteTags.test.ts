import { describe, expect, it } from "vitest";
import {
  completedNoteHashtagCursor,
  editableTags,
  isHiddenTag,
  isReservedTag,
  normalizeTag,
  normalizeTags,
  processCompletedNoteHashtags,
  processNoteHashtags,
} from "../shared/notes/tags.ts";

describe("note tags", () => {
  it("normalizes Obsidian-style freeform and hierarchical tags", () => {
    expect(normalizeTag(" #Question ")).toBe("question");
    expect(normalizeTag("Theme / Identity")).toBe("theme/identity");
    expect(normalizeTag("book/The Left Hand of Darkness")).toBe("book/the-left-hand-of-darkness");
  });

  it("deduplicates, sorts, and drops empty tags", () => {
    expect(normalizeTags(["Zed", "#alpha", "ALPHA", "---"])).toEqual(["alpha", "zed"]);
  });

  it("extracts inline hashtags and removes them from the note body", () => {
    expect(
      processNoteHashtags("# Heading\nA #Question and ##Thought about ##theme/Identity.\n\n##joke"),
    ).toEqual({
      body: "# Heading\nA #Question and about.",
      tags: ["joke", "theme/identity", "thought"],
    });
  });

  it("only converts completed hashtags during live editing", () => {
    expect(processCompletedNoteHashtags("A ##quest")).toEqual({ body: "A ##quest", tags: [] });
    expect(processCompletedNoteHashtags("A ##question ")).toEqual({
      body: "A ",
      tags: ["question"],
    });
    expect(completedNoteHashtagCursor("A ##question ")).toBe(2);
  });

  it("keeps semantic tags in the common namespace while reserving their editing", () => {
    expect(isReservedTag("highlight")).toBe(true);
    expect(isHiddenTag("highlight")).toBe(true);
    expect(editableTags(["highlight", "question"])).toEqual(["question"]);
  });
});
