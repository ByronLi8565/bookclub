// @vitest-environment jsdom

import { beforeEach, describe, it } from "vitest";
import { blockquote } from "../../client/logic/notes/format.ts";
import {
  FocusedNoteHighlight,
  NotesModel,
  initialNotesModel,
  notesView,
  type NotesMessage,
} from "../../client/foldkit/notes.ts";
import { avatarFor, highlight, notes, rootNote, viewer } from "./notesFixture.ts";
import { expectRecordedParity, renderFoldkit, stubAnimationFrame } from "./parity.ts";

const sourceId = rootNote.sourceId;
const groupRef = "club-alpha";
const bookTitles = new Map([[sourceId, "The Book"]]);

const ready: NotesModel = { ...initialNotesModel(), ready: true, status: "online", notes };

const foldkitPanel = (model: NotesModel) =>
  renderFoldkit<NotesModel, NotesMessage>({
    Model: NotesModel,
    model,
    view: (current, h) =>
      notesView(
        current,
        {
          sourceId,
          groupRef,
          viewer,
          avatarFor,
          bookTitles,
          jumpToHighlight: () => FocusedNoteHighlight({ highlightId: null }),
        },
        h,
      ),
  });

describe("note panel parity", () => {
  beforeEach(stubAnimationFrame);

  it("renders the thread React rendered", async () => {
    expectRecordedParity("notes-thread", await foldkitPanel(ready));
  });

  it("marks an unsynced note the way React did", async () => {
    expectRecordedParity(
      "notes-unsynced",
      await foldkitPanel({ ...ready, pendingNoteIds: [notes[0].id], failedNoteIds: [notes[1].id] }),
    );
  });

  it("renders the loading panel React rendered", async () => {
    expectRecordedParity(
      "notes-loading",
      await foldkitPanel({ ...initialNotesModel(), ready: false, status: "offline" }),
    );
  });

  it("opens the composer on a quoted passage the way React did", async () => {
    // React puts the passage in the body as a blockquote and keeps the highlight
    // itself out of sight — no chip, and no separate control to attach it with.
    expectRecordedParity(
      "notes-composing",
      await foldkitPanel({
        ...ready,
        composing: true,
        draft: `${blockquote(highlight.quote.exact)}\n\n`,
        draftHighlights: [highlight],
      }),
    );
  });

  it("renders the empty panel React rendered", async () => {
    expectRecordedParity("notes-empty", await foldkitPanel({ ...ready, notes: [] }));
  });
});
