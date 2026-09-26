import { Story } from "foldkit/test";
import { describe, expect, it, vi } from "vitest";
import { ChangedNotes, QueuedNoteOperation } from "../../client/foldkit/resources/noteAgent.ts";
import {
  ChangedNoteDraft,
  ChangedNoteDraftSelection,
  ExtractedNoteDraftTags,
  PastedNoteImage,
  RemovedNoteImage,
  RetriedNoteImage,
} from "../../client/foldkit/mounts/lexical.ts";
import {
  AddedNoteFilterTerm,
  AttachedNoteHighlight,
  ClearedNoteFilters,
  FollowedNoteReference,
  RemovedNoteDraftTag,
  StartedNoteReply,
  CancelledNoteComposer,
  EnqueueNoteOperation,
  FailedNoteImageUpload,
  StartedNoteEdit,
  SubmittedNoteOperation,
  DiscardNoteImage,
  MarkNoteImageFailed,
  ResolveNoteImage,
  ShowPendingNoteImage,
  CompletedImageAction,
  UploadNoteImage,
  UploadedNoteImage,
  initialNotesModel,
  updateNotes,
} from "../../client/foldkit/notes.ts";
import { addNoteOp } from "../../client/logic/notes/noteOps.ts";
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
      }),
    );
  });

  it("folds editor draft, tags, and selection without rebuilding the editor", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.model((model) => expect(model.composerGeneration).toBe(0)),
      Story.message(
        ChangedNoteDraft({
          groupRef: "club-alpha",
          body: "a passage",
          imageIds: ["image-1"],
          unresolvedImages: 0,
        }),
      ),
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
      Story.message(
        ChangedNoteDraft({
          groupRef: "club-alpha",
          body: "half a thought",
          imageIds: [],
          unresolvedImages: 0,
        }),
      ),
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
    );
  });

  it("carries attached quotes into the submitted operation and clears them after", () => {
    const op = addNoteOp("source-1", "what this passage means", [highlight]);

    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(AttachedNoteHighlight({ highlight })),
      Story.message(
        ChangedNoteDraft({
          groupRef: "club-alpha",
          body: "what this passage means",
          imageIds: [],
          unresolvedImages: 0,
        }),
      ),
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

  const withToken = (token: `${string}-${string}-${string}-${string}-${string}`) =>
    vi.spyOn(crypto, "randomUUID").mockReturnValue(token);

  it("shows a pasted image while it uploads, then settles it in the editor", () => {
    const file = new File([Uint8Array.from([1, 2, 3])], "shot.png", { type: "image/png" });
    const token = "11111111-1111-4111-8111-111111111111" as const;
    withToken(token);

    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(
        ChangedNoteDraft({
          groupRef: "club-alpha",
          body: "look at this",
          imageIds: [],
          unresolvedImages: 0,
        }),
      ),
      Story.message(PastedNoteImage({ groupRef: "club-alpha", file })),
      Story.model((model) => expect(model.uploadingImageTokens).toEqual([token])),
      // The image reaches the document before its bytes reach the server.
      Story.Command.expectExact(
        ShowPendingNoteImage({ token, file }),
        UploadNoteImage({ groupRef: "club-alpha", token, file }),
      ),
      Story.Command.resolve(ShowPendingNoteImage, CompletedImageAction()),
      Story.Command.resolve(UploadNoteImage, UploadedNoteImage({ token, imageId: "image-1" })),
      Story.Command.resolve(ResolveNoteImage, CompletedImageAction()),
      Story.model((model) => {
        expect(model.draftImageIds).toEqual(["image-1"]);
        expect(model.uploadingImageTokens).toEqual([]);
        // The editor keeps its content, so nothing re-seeds the composer.
        expect(model.composerGeneration).toBe(0);
      }),
    );
  });

  it("keeps saying it is uploading until every pasted image has landed", () => {
    const first = new File([Uint8Array.from([4])], "one.png", { type: "image/png" });
    const second = new File([Uint8Array.from([5])], "two.png", { type: "image/png" });
    const tokens = [
      "22222222-2222-4222-8222-222222222222",
      "44444444-4444-4444-8444-444444444444",
    ] as const;
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(tokens[0]).mockReturnValueOnce(tokens[1]);

    const [one] = updateNotes(
      initialNotesModel(),
      PastedNoteImage({ groupRef: "club-alpha", file: first }),
    );
    const [both] = updateNotes(one, PastedNoteImage({ groupRef: "club-alpha", file: second }));
    const [landed] = updateNotes(both, UploadedNoteImage({ token: tokens[0], imageId: "image-1" }));
    // One image is still on its way, so the hint must still say so.
    expect(landed.uploadingImageTokens).toEqual([tokens[1]]);
    const [done] = updateNotes(landed, UploadedNoteImage({ token: tokens[1], imageId: "image-2" }));
    expect(done.uploadingImageTokens).toEqual([]);
    expect(done.draftImageIds).toEqual(["image-1", "image-2"]);
  });

  it("marks a failed upload in the editor so it can be retried", () => {
    const file = new File([Uint8Array.from([1])], "shot.png", { type: "image/png" });
    const token = "33333333-3333-4333-8333-333333333333" as const;
    withToken(token);

    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(PastedNoteImage({ groupRef: "club-alpha", file })),
      Story.Command.resolve(ShowPendingNoteImage, CompletedImageAction()),
      Story.Command.resolve(UploadNoteImage, FailedNoteImageUpload({ token })),
      Story.model((model) => expect(model.uploadingImageTokens).toEqual([])),
      // The failed image stays in the document, marked, so it can go again.
      Story.Command.resolve(MarkNoteImageFailed({ token }), CompletedImageAction()),
      // The editor kept the file, so a retry is the same upload again.
      Story.message(RetriedNoteImage({ groupRef: "club-alpha", token, file })),
      Story.Command.resolve(UploadNoteImage, UploadedNoteImage({ token, imageId: "image-2" })),
      Story.Command.resolve(ResolveNoteImage, CompletedImageAction()),
      Story.model((model) => expect(model.draftImageIds).toEqual(["image-2"])),
    );
  });

  it("discards the upload behind an image removed from the draft", () => {
    Story.story(
      updateNotes,
      Story.given({ ...initialNotesModel(), draftImageIds: ["image-1"] }),
      Story.message(
        RemovedNoteImage({ groupRef: "club-alpha", imageId: "image-1", token: "token-1" }),
      ),
      Story.model((model) => expect(model.draftImageIds).toEqual([])),
      Story.Command.expectExact(DiscardNoteImage({ groupRef: "club-alpha", imageId: "image-1" })),
      Story.Command.resolve(DiscardNoteImage, CompletedImageAction()),
    );
  });

  it("leaves nothing to discard when the removed image never uploaded", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(RemovedNoteImage({ groupRef: "club-alpha", imageId: "", token: "token-2" })),
      Story.Command.expectNone(),
    );
  });

  it("opens one composer at a time and remembers which note it answers", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(AttachedNoteHighlight({ highlight })),
      Story.model((model) => {
        expect(model.composing).toBe(true);
        expect(model.replyingToNoteId).toBeNull();
      }),
      Story.message(StartedNoteReply({ noteId: note.id })),
      Story.model((model) => {
        expect(model.replyingToNoteId).toBe(note.id);
        // The reply composer is the note's, so the panel's own one closes.
        expect(model.composing).toBe(false);
      }),
      Story.message(
        StartedNoteEdit({
          noteId: note.id,
          body: note.body,
          tags: note.tags ?? [],
          highlights: note.highlights,
        }),
      ),
      Story.model((model) => {
        expect(model.editingNoteId).toBe(note.id);
        expect(model.replyingToNoteId).toBeNull();
      }),
      Story.message(CancelledNoteComposer()),
      Story.model((model) => {
        expect(model.editingNoteId).toBeNull();
        expect(model.replyingToNoteId).toBeNull();
        expect(model.composing).toBe(false);
      }),
    );
  });

  it("opens the composer when the reader quotes a passage into it", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(AttachedNoteHighlight({ highlight })),
      Story.model((model) => expect(model.composing).toBe(true)),
    );
  });

  it("widens the scope when a filter asks about a book other than this one", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.model((model) => expect(model.scope).toBe("current-book")),
      Story.message(
        AddedNoteFilterTerm({
          term: { kind: "property", property: "book", value: "source-2", negated: false },
        }),
      ),
      Story.model((model) => expect(model.scope).toBe("all-books")),
      Story.message(ClearedNoteFilters()),
      Story.model((model) => expect(model.filterTerms).toEqual([])),
    );
  });

  it("follows a numbered reference to the note it names", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(
        ChangedNotes({
          ready: true,
          notes: [note],
          pendingNoteIds: [],
          failedNoteIds: [],
          pendingCount: 0,
        }),
      ),
      Story.message(FollowedNoteReference({ seq: note.seq })),
      Story.model((model) => expect(model.focusedNoteId).toBe(note.id)),
      // A reference to a note this panel does not hold leaves the focus alone.
      Story.message(FollowedNoteReference({ seq: 404 })),
      Story.model((model) => expect(model.focusedNoteId).toBe(note.id)),
    );
  });

  it("drops a tag the reader took back off the draft", () => {
    Story.story(
      updateNotes,
      Story.given(initialNotesModel()),
      Story.message(ExtractedNoteDraftTags({ tags: ["theme", "question"] })),
      Story.message(RemovedNoteDraftTag({ tag: "theme" })),
      Story.model((model) => expect(model.draftTags).toEqual(["question"])),
    );
  });
});
