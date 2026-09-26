// @vitest-environment jsdom

import { Story } from "foldkit/test";
import { describe, expect, it } from "vitest";
import {
  CancelledBookFieldEdit,
  ChangedBookFieldDraft,
  CommittedBookFieldEdit,
  FailedBookInspection,
  FailedBookUpload,
  InspectBook,
  SelectedBookFile,
  StartedBookFieldEdit,
  SubmittedBookUpload,
  UploadBook,
  type UploadModel,
  canUploadBook,
  initialUploadModel,
  updateUpload,
  type InspectedBook,
} from "../../client/foldkit/upload.ts";

const groupRef = "parity-club-abc123";

const book: InspectedBook = {
  token: "book-token",
  fileName: "dorian-gray.epub",
  fileSize: 1024,
  kind: "epub",
  contentType: "application/epub+zip",
  title: "The Picture of Dorian Gray",
  author: "Oscar Wilde",
  wordCount: 1234,
  cover: null,
  health: {
    status: "ok",
    capabilities: {
      selectableText: true,
      textAnchors: true,
      rectAnchors: true,
      pageNavigation: false,
    },
    issues: [],
  },
};

const unreadable: InspectedBook = {
  ...book,
  health: {
    status: "error",
    capabilities: null,
    issues: [{ code: "no_text_layer", message: "This PDF has no text layer.", page: null }],
  },
};

const chosenFile = (): File =>
  new File(["book bytes"], "dorian-gray.epub", { type: "application/epub+zip" });

const ready = (inspected: InspectedBook = book): UploadModel => ({
  ...initialUploadModel(),
  status: "ready",
  inspected,
});

describe("Foldkit upload stories", () => {
  it("reports the unsupported file the way the drop zone reads it", () => {
    Story.story(
      updateUpload,
      Story.given(initialUploadModel()),
      Story.message(SelectedBookFile({ file: chosenFile() })),
      Story.Command.resolve(InspectBook, FailedBookInspection({ reason: "unsupported_type" })),
      Story.model((model) => {
        expect(model.status).toBe("idle");
        expect(model.inspected).toBeNull();
        expect(model.error).toBe("Unsupported file — choose an EPUB or PDF.");
      }),
    );
  });

  it("renames the title in place and takes an emptied field as no title at all", () => {
    Story.story(
      updateUpload,
      Story.given(ready()),
      Story.message(StartedBookFieldEdit({ field: "title" })),
      Story.model((model) => expect(model.editDraft).toBe(book.title)),
      Story.message(ChangedBookFieldDraft({ value: "  Dorian Gray  " })),
      Story.message(CommittedBookFieldEdit()),
      Story.model((model) => {
        expect(model.inspected?.title).toBe("Dorian Gray");
        expect(model.editingField).toBeNull();
      }),
      Story.message(StartedBookFieldEdit({ field: "author" })),
      Story.message(ChangedBookFieldDraft({ value: "   " })),
      Story.message(CommittedBookFieldEdit()),
      Story.model((model) => expect(model.inspected?.author).toBeNull()),
      Story.message(StartedBookFieldEdit({ field: "title" })),
      Story.message(ChangedBookFieldDraft({ value: "abandoned" })),
      Story.message(CancelledBookFieldEdit()),
      Story.model((model) => expect(model.inspected?.title).toBe("Dorian Gray")),
    );
  });

  it("leaves a failed upload ready to try again", () => {
    Story.story(
      updateUpload,
      Story.given(ready()),
      Story.message(SubmittedBookUpload({ groupRef })),
      Story.Command.resolve(UploadBook, FailedBookUpload({ message: "boom" })),
      Story.model((model) => {
        expect(model.status).toBe("ready");
        expect(model.inspected).toEqual(book);
      }),
    );
  });

  it("refuses to upload a book whose health came back as an error", () => {
    Story.story(
      updateUpload,
      Story.given(ready(unreadable)),
      Story.model((model) => expect(canUploadBook(model)).toBe(false)),
      Story.message(SubmittedBookUpload({ groupRef })),
      Story.Command.expectNone(),
      Story.model((model) => expect(model.status).toBe("ready")),
    );
  });
});
