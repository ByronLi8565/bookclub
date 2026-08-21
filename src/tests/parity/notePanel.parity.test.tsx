// @vitest-environment jsdom

import { createElement } from "react";
import { beforeEach, describe, it } from "vitest";
import { buildConversation, referenceSpace } from "../../client/logic/notes/conversation.ts";
import { noteFilterSuggestions } from "../../client/logic/notes/noteQuery.ts";
import { NoteFilterBar } from "../../client/ui/notes/NoteFilterBar.tsx";
import { NotePanel } from "../../client/ui/notes/NotePanel.tsx";
import {
  FocusedNoteHighlight,
  NotesModel,
  initialNotesModel,
  notesView,
  type NotesMessage,
} from "../../client/foldkit/notes.ts";
import {
  noteQueryContextOf,
  noteQueryOf,
  notesScopeOf,
} from "../../client/foldkit/notesFilters.ts";
import { blockquote } from "../../client/logic/notes/format.ts";
import { avatarFor, highlight, notes, rootNote, viewer } from "./notesFixture.ts";
import {
  enableReactActEnvironment,
  expectParity,
  renderFoldkit,
  renderReact,
  stubAnimationFrame,
} from "./parity.ts";

const noop = (): void => {};
const sourceId = rootNote.sourceId;
const groupRef = "club-alpha";
const imageUrlBase = `/groups/${groupRef}/images`;
const bookTitles = new Map([[sourceId, "The Book"]]);

interface Scenario {
  readonly notes: typeof notes;
  readonly loading: boolean;
  readonly composing?: boolean;
  readonly pending?: ReadonlySet<string>;
  readonly failed?: ReadonlySet<string>;
  readonly editingId?: string | null;
  readonly replyingTo?: string | null;
}

const NONE: ReadonlySet<string> = new Set();

const reactPanel = (overrides: Scenario) => {
  const context = noteQueryContextOf(overrides.notes, bookTitles);
  const space = referenceSpace([...overrides.notes]);
  return createElement(NotePanel, {
    conversation: buildConversation([...overrides.notes]),
    canWrite: !overrides.loading,
    composing: overrides.composing ?? false,
    loading: overrides.loading,
    composeInitialBody:
      overrides.composing === true ? `${blockquote(highlight.quote.exact)}\n\n` : "",
    onComposeSave: noop,
    onComposeCancel: noop,
    filters: createElement(NoteFilterBar, {
      scope: notesScopeOf("current-book", sourceId),
      query: noteQueryOf([], "all"),
      context,
      suggestions: noteFilterSuggestions(overrides.notes, context),
      currentSourceId: sourceId,
      onScopeChange: noop,
      onQueryChange: noop,
    }),
    hasActiveFilters: false,
    showBookTitles: false,
    showHashtags: true,
    hashtagsAddTags: false,
    bookTitleFor: (id: string) => bookTitles.get(id) ?? "Untitled book",
    contextNoteIds: new Set<string>(),
    refs: {
      validSeqs: space.validSeqs,
      byId: new Map(overrides.notes.map((note) => [note.id, note] as const)),
      refs: space.refs,
      canReference: true,
      pendingNoteIds: overrides.pending ?? NONE,
      failedNoteIds: overrides.failed ?? NONE,
    },
    viewer,
    avatarFor,
    imageUrlBase,
    actions: {
      editingId: overrides.editingId ?? null,
      replyingTo: overrides.replyingTo ?? null,
      onJump: noop,
      onReference: noop,
      onDelete: noop,
      onEdit: noop,
      onEditSave: noop,
      onEditCancel: noop,
      onTagFilter: noop,
      onBookFilter: noop,
      onReply: noop,
      onReplySave: noop,
      onReplyCancel: noop,
    },
  });
};

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
  beforeEach(() => {
    enableReactActEnvironment();
    stubAnimationFrame();
  });

  it("renders a thread the way React does", async () => {
    const react = await renderReact(reactPanel({ notes, loading: false }));
    const foldkit = await foldkitPanel({
      ...initialNotesModel(),
      ready: true,
      status: "online",
      notes,
    });
    expectParity("notes-thread", react, foldkit);
  });

  it("marks a note that has not synced the way React does", async () => {
    const pending = new Set([notes[0].id]);
    const failed = new Set([notes[1].id]);
    const react = await renderReact(reactPanel({ notes, loading: false, pending, failed }));
    const foldkit = await foldkitPanel({
      ...initialNotesModel(),
      ready: true,
      status: "online",
      notes,
      pendingNoteIds: [...pending],
      failedNoteIds: [...failed],
    });
    expectParity("notes-unsynced", react, foldkit);
  });

  it("renders the loading panel the way React does", async () => {
    const react = await renderReact(reactPanel({ notes: [], loading: true }));
    const foldkit = await foldkitPanel({ ...initialNotesModel(), ready: false, status: "offline" });
    expectParity("notes-loading", react, foldkit);
  });

  it("opens the composer on a quoted passage the way React does", async () => {
    // React puts the passage in the body as a blockquote and keeps the highlight
    // itself out of sight — no chip, and no separate control to attach it with.
    const react = await renderReact(reactPanel({ notes, loading: false, composing: true }));
    const foldkit = await foldkitPanel({
      ...initialNotesModel(),
      ready: true,
      status: "online",
      notes,
      composing: true,
      draft: `${blockquote(highlight.quote.exact)}\n\n`,
      draftHighlights: [highlight],
    });
    expectParity("notes-composing", react, foldkit);
  });

  it("renders an empty panel the way React does", async () => {
    const react = await renderReact(reactPanel({ notes: [], loading: false }));
    const foldkit = await foldkitPanel({
      ...initialNotesModel(),
      ready: true,
      status: "online",
      notes: [],
    });
    expectParity("notes-empty", react, foldkit);
  });
});
