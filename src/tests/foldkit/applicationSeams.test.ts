// @vitest-environment jsdom

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  Club,
  Model,
  Navigated,
  init,
  update,
  type Message,
} from "../../client/foldkit/application.ts";
import { NotesMessage, isNotesMessage } from "../../client/foldkit/notes.ts";
import {
  ClickedEpubHighlight,
  OpenedEpub,
  SelectedEpubText,
} from "../../client/foldkit/mounts/epub.ts";
import { FollowedNoteReference } from "../../client/foldkit/notes.ts";
import {
  ChangedNotes,
  ConnectedNoteAgent,
  FailedNoteAgentConnection,
  ReleasedNoteAgent,
} from "../../client/foldkit/resources/noteAgent.ts";
import {
  CommittedReaderSelection,
  JumpedToHighlight,
  ReaderMessage,
  SelectedReaderSource,
  isReaderMessage,
} from "../../client/foldkit/reader.ts";
import { HIGHLIGHT_TAG } from "../../shared/types/notes.ts";

/**
 * `update` dispatches to the reader and notes slices by schema guard before its
 * own switch, so a tag claimed by two unions would be silently swallowed by
 * whichever guard runs first.
 */
interface TaggedUnion {
  readonly members: readonly {
    readonly fields: { readonly _tag: { readonly ast: { readonly literal: string } } };
  }[];
}

const unionTags = (union: unknown): readonly string[] => {
  // SAFETY: both unions are `Schema.Union`s whose every member is built by
  // `m()`, so each carries a `_tag` literal field. Asserted rather than decoded
  // because this reads Schema internals the public API does not expose.
  const { members } = union as TaggedUnion;
  const tags = members.map((member) => member.fields._tag.ast.literal);
  expect(tags.every((tag) => typeof tag === "string")).toBe(true);
  return tags;
};

const readerTags = unionTags(ReaderMessage);
const notesTags = unionTags(NotesMessage);

describe("Foldkit application slice seams", () => {
  it("routes each slice's tags to exactly one owner", () => {
    expect(readerTags.length).toBeGreaterThan(0);
    expect(notesTags.length).toBeGreaterThan(0);
    expect(readerTags.filter((tag) => notesTags.includes(tag))).toEqual([]);

    // The guards must agree with the unions they were derived from.
    expect(readerTags.every((tag) => !notesTags.includes(tag))).toBe(true);
    expect(
      isReaderMessage(
        SelectedReaderSource({ groupRef: "club-alpha", sourceId: "source-1", kind: "epub" }),
      ),
    ).toBe(true);
    expect(
      isNotesMessage(
        SelectedReaderSource({ groupRef: "club-alpha", sourceId: "source-1", kind: "epub" }),
      ),
    ).toBe(false);
  });

  it("opens a reader workspace and keeps the whole model serializable", () => {
    const [initial] = init();
    expect(initial.reader).toBeNull();

    const [opened] = update(
      initial,
      SelectedReaderSource({ groupRef: "club-alpha", sourceId: "source-1", kind: "epub" }),
    );
    // A club is its open book: opening one stays on the club's own route.
    expect(opened.route).toEqual(Club({ groupRef: "club-alpha" }));
    expect(opened.reader?.sourceId).toBe("source-1");
    expect(opened.reader?.loading).toBe(true);

    // Catches drift between ReaderWorkspace/NotesModel and the Model schema.
    expect(Schema.decodeUnknownSync(Model)(JSON.parse(JSON.stringify(opened)))).toEqual(opened);
  });

  it("folds a Mount message into the open reader rather than dropping it", () => {
    const [initial] = init();
    const [opened] = update(
      initial,
      SelectedReaderSource({ groupRef: "club-alpha", sourceId: "source-1", kind: "epub" }),
    );

    const [loaded] = update(
      opened,
      OpenedEpub({
        sourceId: "source-1",
        title: "Dorian Gray",
        place: {
          spineIndex: 0,
          cfi: "epubcfi(/6/2)",
          page: 1,
          count: { page: 1, total: 4, percentage: 0.25 },
          atStart: true,
          atEnd: false,
        },
      }),
    );
    expect(loaded.reader?.loading).toBe(false);
    expect(loaded.reader?.title).toBe("Dorian Gray");
  });

  it("ignores reader messages that arrive with no reader open", () => {
    const [initial] = init();
    const [next, commands] = update(
      initial,
      OpenedEpub({ sourceId: "source-1", title: "Dorian Gray", place: null }),
    );
    expect(next).toBe(initial);
    expect(commands).toEqual([]);
  });

  it("folds note-agent messages into the notes slice without touching the reader", () => {
    const [initial] = init();
    const [next] = update(
      initial,
      ChangedNotes({
        ready: true,
        notes: [],
        pendingNoteIds: [],
        failedNoteIds: [],
        pendingCount: 0,
      }),
    );
    expect(next.notes.ready).toBe(true);
    expect(next.reader).toBeNull();
    expect(Schema.decodeUnknownSync(Model)(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it("claims a note connection only once acquisition reports it, and drops it on release", () => {
    const [initial] = init();
    // A stream started before acquisition has no queue to read, so the key must
    // stay null no matter what the requirements already look like.
    expect(initial.notes.connectionKey).toBeNull();

    const [connected] = update(
      initial,
      ConnectedNoteAgent({ groupId: "club-alpha", agentName: "club-alpha" }),
    );
    expect(connected.notes.connectionKey).toBe("club-alpha");

    // A club switch must hand out a new key rather than reuse the old stream.
    const [switched] = update(
      connected,
      ConnectedNoteAgent({ groupId: "club-beta", agentName: "club-beta" }),
    );
    expect(switched.notes.connectionKey).toBe("club-beta");

    const [released] = update(switched, ReleasedNoteAgent());
    expect(released.notes.connectionKey).toBeNull();

    const [failed] = update(
      connected,
      FailedNoteAgentConnection({ groupId: "club-alpha", reason: "socket refused" }),
    );
    expect(failed.notes.connectionKey).toBeNull();
  });

  it("leaves application-owned messages to the application switch", () => {
    const [initial] = init();
    const navigated: Message = Navigated({ route: { _tag: "Home" } });
    expect(isReaderMessage(navigated)).toBe(false);
    expect(isNotesMessage(navigated)).toBe(false);

    const [next] = update(initial, navigated);
    expect(next.route._tag).toBe("Home");
  });

  const openedReader = () => {
    const [initial] = init();
    return update(
      initial,
      SelectedReaderSource({ groupRef: "club-alpha", sourceId: "source-1", kind: "epub" }),
    )[0];
  };

  const withSelection = () =>
    update(
      openedReader(),
      SelectedEpubText({
        sourceId: "source-1",
        cfi: "epubcfi(/6/2)",
        quote: {
          type: "TextQuoteSelector",
          exact: "a passage",
          prefix: "before ",
          suffix: " after",
        },
        point: { x: 12, y: 24 },
      }),
    )[0];

  it("turns a committed highlight into a posted note carrying the passage", () => {
    const [committed, commands] = update(
      withSelection(),
      CommittedReaderSelection({ intent: "highlight" }),
    );

    expect(committed.reader?.selection).toBeNull();
    // The note is queued through the notes slice's own operation Command, and
    // the highlight keeps the quote context the reader captured.
    expect(commands.map((command) => command.name)).toContain("EnqueueNoteOperation");
    expect(committed.notes.draftHighlights).toEqual([]);
  });

  it("carries a committed note selection into the composer as a quoted passage", () => {
    const [composing] = update(withSelection(), CommittedReaderSelection({ intent: "note" }));

    expect(composing.notes.draftHighlights).toHaveLength(1);
    expect(composing.notes.draftHighlights[0]?.quote.exact).toBe("a passage");
    expect(composing.notes.draftHighlights[0]?.quote.prefix).toBe("before ");
    // The reader paints what the notes slice now holds.
    expect(composing.reader?.highlights).toHaveLength(1);
  });

  it("focuses the note a clicked highlight belongs to", () => {
    const opened = openedReader();
    const highlight = {
      id: "highlight-1",
      sourceId: "source-1",
      anchor: { kind: "epub-cfi" as const, value: "epubcfi(/6/2)" },
      quote: { type: "TextQuoteSelector" as const, exact: "a passage", prefix: "", suffix: "" },
      createdAt: "2026-08-17T00:00:00.000Z",
    };
    const withNote = {
      ...opened,
      notes: {
        ...opened.notes,
        notes: [
          {
            id: "note-1",
            seq: 1,
            sourceId: "source-1",
            author: { id: "reader-1", name: "Reader" },
            parent: null,
            body: "a passage",
            highlights: [highlight],
            tags: [HIGHLIGHT_TAG],
            createdAt: "2026-08-17T00:00:00.000Z",
            editedAt: null,
            deletedAt: null,
            version: 1,
          },
        ],
      },
    };

    const [focused] = update(
      withNote,
      ClickedEpubHighlight({ sourceId: "source-1", highlightId: "highlight-1" }),
    );
    expect(focused.notes.focusedNoteId).toBe("note-1");
    expect(focused.reader?.activeHighlightId).toBe("highlight-1");
  });

  const noteOn = (
    seq: number,
    sourceId: string,
    highlight: {
      anchor: { kind: "epub-cfi"; value: string } | { kind: "pdf-text"; page: number; rects: [] };
    } | null,
  ) => ({
    id: `note-${seq}`,
    seq,
    sourceId,
    author: { id: "reader-1", name: "Reader" },
    parent: null,
    body: `note ${seq}`,
    highlights:
      highlight === null
        ? []
        : [
            {
              id: `hl-${seq}`,
              sourceId,
              anchor: highlight.anchor,
              quote: {
                type: "TextQuoteSelector" as const,
                exact: "a passage",
                prefix: "",
                suffix: "",
              },
              createdAt: "2026-08-17T00:00:00.000Z",
            },
          ],
    tags: [],
    createdAt: "2026-08-17T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    version: 1,
  });

  it("follows a numbered reference to where that note sits in the book", () => {
    const anchor = { kind: "epub-cfi" as const, value: "epubcfi(/6/12)" };
    const reading = openedReader();
    const withNotes = {
      ...reading,
      notes: {
        ...reading.notes,
        notes: [noteOn(1, "source-1", null), noteOn(3, "source-1", { anchor })],
      },
    };

    const [followed, commands] = update(withNotes, FollowedNoteReference({ seq: 3 }));
    // Following [[3]] is clicking note 3: the panel focuses it and the reader
    // goes to its passage, rather than only the former.
    expect(followed.notes.focusedNoteId).toBe("note-3");
    expect(followed.reader?.pane).toBe("reader");
    expect(commands.map((command) => command.name)).toContain("GoToReaderAnchor");
  });

  it("opens the other book to follow a reference into it", () => {
    const group = {
      groupId: "group-1",
      slug: "club",
      publicId: "alpha",
      displayName: "Club",
      ownerId: "reader-1",
      sources: ["source-1", "source-2"],
      bookTitles: {},
      sourceMeta: {
        "source-1": {
          kind: "epub" as const,
          contentType: "application/epub+zip",
          size: 1,
          addedBy: "reader-1",
        },
        "source-2": {
          kind: "epub" as const,
          contentType: "application/epub+zip",
          size: 1,
          addedBy: "reader-1",
        },
      },
      memberCount: 1,
    };
    const anchor = { kind: "epub-cfi" as const, value: "epubcfi(/6/12)" };
    const reading = openedReader();
    const withNotes = {
      ...reading,
      currentGroup: group,
      notes: { ...reading.notes, notes: [noteOn(3, "source-2", { anchor })] },
    };

    const [followed] = update(withNotes, FollowedNoteReference({ seq: 3 }));
    expect(followed.reader?.sourceId).toBe("source-2");
    expect(followed.pendingJump).toEqual({ sourceId: "source-2", anchor });
  });

  it("only focuses a referenced note that has no passage to go to", () => {
    const reading = openedReader();
    const withNotes = {
      ...reading,
      notes: { ...reading.notes, notes: [noteOn(3, "source-1", null)] },
    };

    const [followed, commands] = update(withNotes, FollowedNoteReference({ seq: 3 }));
    expect(followed.notes.focusedNoteId).toBe("note-3");
    expect(commands.map((command) => command.name)).not.toContain("GoToReaderAnchor");
  });

  it("opens the other book before jumping to a note that lives in it", () => {
    // The note list shows every book's notes, so the note clicked is often not
    // about the book on screen. Jumping used to send the open book an anchor it
    // could not resolve, and nothing happened at all.
    const group = {
      groupId: "group-1",
      slug: "club",
      publicId: "alpha",
      displayName: "Club",
      ownerId: "reader-1",
      sources: ["source-1", "source-2"],
      bookTitles: {},
      sourceMeta: {
        "source-1": {
          kind: "epub" as const,
          contentType: "application/epub+zip",
          size: 1,
          addedBy: "reader-1",
        },
        "source-2": {
          kind: "epub" as const,
          contentType: "application/epub+zip",
          size: 1,
          addedBy: "reader-1",
        },
      },
      memberCount: 1,
    };
    const anchor = { kind: "epub-cfi" as const, value: "epubcfi(/6/8)" };
    const reading = { ...openedReader(), currentGroup: group };

    const [switching, switchCommands] = update(
      reading,
      JumpedToHighlight({ sourceId: "source-2", anchor }),
    );
    // The other book is opened and the anchor is held, not thrown at the reader
    // that cannot resolve it.
    expect(switching.reader?.sourceId).toBe("source-2");
    expect(switching.pendingJump).toEqual({ sourceId: "source-2", anchor });
    expect(switchCommands.map((command) => command.name)).not.toContain("GoToReaderAnchor");

    // A book still loading cannot resolve an anchor either, so the jump waits.
    expect(switching.reader?.loading).toBe(true);

    const [arrived, arrivedCommands] = update(
      switching,
      OpenedEpub({ sourceId: "source-2", title: "The Other Book", place: null }),
    );
    expect(arrived.pendingJump).toBeNull();
    expect(arrived.reader?.pane).toBe("reader");
    expect(arrivedCommands.map((command) => command.name)).toContain("GoToReaderAnchor");
  });

  it("ignores an anchor meant for a book that is not open", () => {
    const [ignored, commands] = update(
      openedReader(),
      JumpedToHighlight({
        sourceId: "source-9",
        anchor: { kind: "epub-cfi", value: "epubcfi(/6/8)" },
      }),
    );
    // No club loaded, so there is no book to switch to; the open reader must not
    // be sent someone else's anchor.
    expect(ignored.reader?.sourceId).toBe("source-1");
    expect(commands.map((command) => command.name)).not.toContain("GoToReaderAnchor");
  });

  it("sends the reader back to the passage a note points at", () => {
    const [jumped, commands] = update(
      openedReader(),
      JumpedToHighlight({
        sourceId: "source-1",
        anchor: { kind: "epub-cfi", value: "epubcfi(/6/8)" },
      }),
    );
    expect(jumped.reader?.pane).toBe("reader");
    expect(commands.map((command) => command.name)).toEqual(["GoToReaderAnchor"]);
  });
});
