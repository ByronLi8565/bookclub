import { Story } from "foldkit/test";
import { describe, expect, it } from "vitest";
import {
  ChangedNoteAgentStatus,
  ChangedNotes,
  QueuedNoteOperation,
} from "../../client/foldkit/resources/noteAgent.ts";
import {
  ChangedNoteDraft,
  ChangedNoteDraftSelection,
  ExtractedNoteDraftTags,
  FailedNoteEditor,
  PastedNoteImage,
} from "../../client/foldkit/mounts/lexical.ts";
import {
  AttachedNoteHighlight,
  CancelledNoteComposer,
  ChangedNoteComposer,
  DetachedNoteHighlight,
  EnqueueNoteOperation,
  FailedNoteImageUpload,
  SelectedNoteImage,
  StartedNoteEdit,
  SubmittedNoteOperation,
  UploadNoteImage,
  UploadedNoteImage,
  initialNotesModel,
  updateNotes,
} from "../../client/foldkit/notes.ts";
import { addNoteOp, editNoteOp, updateTagsOp } from "../../client/logic/notes/noteOps.ts";
import type { Highlight, Note } from "../../shared/types/notes.ts";

const highlight: Highlight = {
  id: "highlight-1",
  sourceId: "source-1",
  anchor: { kind: "epub-cfi", value: "epubcfi(/6/2)" },
  quote: { type: "TextQuoteSelector", exact: "passage", prefix: "", suffix: "" },
  createdAt: "2026-08-15T00:00:00.000Z",
};

const note: Note = {
  id: "note-1",
  seq: 1,
  sourceId: "source-1",
  author: { id: "reader-1", name: "Reader" },
  parent: null,
  body: "passage",
  highlights: [highlight],
  tags: ["theme"],
  createdAt: "2026-08-15T00:00:00.000Z",
  editedAt: null,
  deletedAt: null,
  version: 1,
};

describe("Foldkit notes stories", () => {
  it("folds the authoritative list and its pending state", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(
        ChangedNotes({
          ready: true,
          notes: [note],
          pendingNoteIds: [note.id],
          failedNoteIds: [],
          pendingCount: 1,
        }),
      ),
      Story.model((model) => {
        expect(model.notes).toEqual([note]);
        expect(model.pendingNoteIds).toEqual([note.id]);
        expect(model.pendingCount).toBe(1);
      }),
    );
  });

  it("composes tags and highlights, then queues the existing NoteStore operation", () => {
    const op = addNoteOp("source-1", "passage", [highlight], ["theme"]);

    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(
        ChangedNoteComposer({ body: "passage", tags: ["theme"], highlights: [highlight] }),
      ),
      Story.model((model) => {
        expect(model.draft).toBe("passage");
        expect(model.draftTags).toEqual(["theme"]);
        expect(model.draftHighlights).toEqual([highlight]);
      }),
      Story.message(SubmittedNoteOperation({ op })),
      Story.Command.expectExact(EnqueueNoteOperation({ op })),
      Story.model((model) => expect(model.editingNoteId).toBeNull()),
      Story.Command.resolve(EnqueueNoteOperation, QueuedNoteOperation({ noteId: op.noteId })),
    );
  });

  it("edits and retags through serializable operations, then reconnects pending work", () => {
    const edit = editNoteOp(note.id, "revised");
    const retag = updateTagsOp(note.id, ["question"], ["theme"]);

    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(
        StartedNoteEdit({
          noteId: note.id,
          body: note.body,
          tags: note.tags ?? [],
          highlights: note.highlights,
        }),
      ),
      Story.model((model) => expect(model.editingNoteId).toBe(note.id)),
      Story.message(SubmittedNoteOperation({ op: edit })),
      Story.Command.resolve(EnqueueNoteOperation, QueuedNoteOperation({ noteId: note.id })),
      Story.message(SubmittedNoteOperation({ op: retag })),
      Story.Command.resolve(EnqueueNoteOperation, QueuedNoteOperation({ noteId: note.id })),
      Story.message(ChangedNoteAgentStatus({ status: "offline" })),
      Story.message(
        ChangedNotes({
          ready: true,
          notes: [note],
          pendingNoteIds: [note.id],
          failedNoteIds: [],
          pendingCount: 1,
        }),
      ),
      Story.model((model) => expect(model.status).toBe("offline")),
      Story.message(ChangedNoteAgentStatus({ status: "online" })),
      Story.message(
        ChangedNotes({
          ready: true,
          notes: [note],
          pendingNoteIds: [],
          failedNoteIds: [],
          pendingCount: 0,
        }),
      ),
      Story.model((model) => {
        expect(model.status).toBe("online");
        expect(model.pendingCount).toBe(0);
      }),
    );
  });

  it("folds editor draft, tags, and selection without rebuilding the editor", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.model((model) => expect(model.composerGeneration).toBe(0)),
      Story.message(ChangedNoteDraft({ body: "a passage", imageIds: ["image-1"] })),
      Story.message(ExtractedNoteDraftTags({ tags: ["theme"] })),
      Story.message(ExtractedNoteDraftTags({ tags: ["theme", "question"] })),
      Story.message(
        ChangedNoteDraftSelection({
          collapsed: false,
          bold: true,
          italic: false,
          highlight: false,
        }),
      ),
      Story.model((model) => {
        expect(model.draft).toBe("a passage");
        expect(model.draftImageIds).toEqual(["image-1"]);
        expect(model.draftTags).toEqual(["theme", "question"]);
        expect(model.draftFormat.bold).toBe(true);
        // Everything above came from the editor itself, so re-seeding it would
        // tear the live Lexical instance down under the reader mid-sentence.
        expect(model.composerGeneration).toBe(0);
      }),
    );
  });

  it("rebuilds the editor only when the composer is re-seeded from the Model", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(ChangedNoteDraft({ body: "half a thought", imageIds: [] })),
      Story.message(
        StartedNoteEdit({
          noteId: note.id,
          body: note.body,
          tags: note.tags ?? [],
          highlights: note.highlights,
        }),
      ),
      Story.model((model) => {
        expect(model.draft).toBe(note.body);
        expect(model.composerGeneration).toBe(1);
      }),
      Story.message(CancelledNoteComposer()),
      Story.model((model) => {
        expect(model.draft).toBe("");
        expect(model.draftImageIds).toEqual([]);
        expect(model.composerGeneration).toBe(2);
      }),
    );
  });

  it("attaches a reader selection once, keyed by where it points", () => {
    const sameAnchor: Highlight = { ...highlight, id: "highlight-2" };

    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(AttachedNoteHighlight({ highlight })),
      Story.message(AttachedNoteHighlight({ highlight: sameAnchor })),
      Story.model((model) => {
        // The reader mints a new id per selection, so a second attach of the same
        // passage must be recognised by its anchor or the note quotes it twice.
        expect(model.draftHighlights).toEqual([highlight]);
      }),
      Story.message(DetachedNoteHighlight({ highlightId: highlight.id })),
      Story.model((model) => expect(model.draftHighlights).toEqual([])),
    );
  });

  it("carries attached quotes into the submitted operation and clears them after", () => {
    const op = addNoteOp("source-1", "what this passage means", [highlight]);

    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(AttachedNoteHighlight({ highlight })),
      Story.message(ChangedNoteDraft({ body: "what this passage means", imageIds: [] })),
      Story.model((model) => {
        // What the composer would build from this Model is what gets submitted.
        expect(addNoteOp("source-1", model.draft, [...model.draftHighlights])).toMatchObject({
          body: "what this passage means",
          highlights: [highlight],
        });
      }),
      Story.message(SubmittedNoteOperation({ op })),
      Story.Command.resolve(EnqueueNoteOperation, QueuedNoteOperation({ noteId: op.noteId })),
      Story.model((model) => expect(model.draftHighlights).toEqual([])),
    );
  });

  it("uploads a chosen image and folds its block into the draft", () => {
    const file = new File([Uint8Array.from([1, 2, 3])], "shot.png", { type: "image/png" });

    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(ChangedNoteDraft({ body: "look at this", imageIds: [] })),
      Story.message(SelectedNoteImage({ groupRef: "club-alpha", file })),
      Story.model((model) => expect(model.uploadingImage).toBe(true)),
      Story.Command.expectExact(UploadNoteImage({ groupRef: "club-alpha", file })),
      Story.Command.resolve(UploadNoteImage, UploadedNoteImage({ imageId: "image-1" })),
      Story.model((model) => {
        expect(model.draft).toBe("look at this\n\n[[image:image-1]]");
        expect(model.draftImageIds).toEqual(["image-1"]);
        expect(model.uploadingImage).toBe(false);
        // The editor holds its own content, so the appended image is only visible
        // once the Mount is rebuilt from the Model.
        expect(model.composerGeneration).toBe(1);
      }),
    );
  });

  it("uploads a pasted image through the same path as a chosen one", () => {
    const file = new File([Uint8Array.from([4, 5])], "pasted.png", { type: "image/png" });

    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(PastedNoteImage({ groupRef: "club-alpha", file })),
      Story.Command.expectExact(UploadNoteImage({ groupRef: "club-alpha", file })),
      Story.Command.resolve(UploadNoteImage, UploadedNoteImage({ imageId: "image-9" })),
      Story.model((model) => {
        expect(model.draft).toBe("[[image:image-9]]");
        expect(model.uploadingImage).toBe(false);
      }),
    );
  });

  it("reports a failed image upload without disabling the composer", () => {
    const file = new File([Uint8Array.from([1])], "shot.png", { type: "image/png" });

    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(SelectedNoteImage({ groupRef: "club-alpha", file })),
      Story.Command.resolve(UploadNoteImage, FailedNoteImageUpload({ message: "image too large" })),
      Story.model((model) => {
        expect(model.error).toBe("image too large");
        expect(model.uploadingImage).toBe(false);
      }),
    );
  });

  it("surfaces an editor failure as the notes error", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(FailedNoteEditor({ message: "editor state was corrupt" })),
      Story.model((model) => expect(model.error).toBe("editor state was corrupt")),
    );
  });
});
