import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { $nodesOfType, createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { NOTE_IMAGE_TRANSFORMER, NoteImageNode } from "../client/ui/notes/editor/NoteImageNode.tsx";

const IMAGE_ID = "01JH0000000000000000000000";

describe("note image editor markdown", () => {
  it("hydrates a saved image token as an image node and preserves it on save", () => {
    const editor = createEditor({
      namespace: "note-image-test",
      nodes: [NoteImageNode],
      onError: (error) => {
        throw error;
      },
    });

    editor.update(
      () => $convertFromMarkdownString(`[[image:${IMAGE_ID}:65]]`, [NOTE_IMAGE_TRANSFORMER]),
      { discrete: true },
    );

    const result = editor
      .getEditorState()
      .read(() => ({
        ids: $nodesOfType(NoteImageNode).map((node) => node.getImageId()),
        widths: $nodesOfType(NoteImageNode).map((node) => node.getWidth()),
        markdown: $convertToMarkdownString([NOTE_IMAGE_TRANSFORMER]),
      }));
    expect(result).toEqual({ ids: [IMAGE_ID], widths: [65], markdown: `[[image:${IMAGE_ID}:65]]` });
  });
});
