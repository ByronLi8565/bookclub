// @vitest-environment jsdom

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Model, Navigated, init, update, type Message } from "../../client/foldkit/application.ts";
import { NotesMessage, isNotesMessage } from "../../client/foldkit/notes.ts";
import { OpenedEpub } from "../../client/foldkit/mounts/epub.ts";
import {
  ChangedNotes,
  ConnectedNoteAgent,
  FailedNoteAgentConnection,
  ReleasedNoteAgent,
} from "../../client/foldkit/resources/noteAgent.ts";
import {
  ReaderMessage,
  SelectedReaderSource,
  isReaderMessage,
} from "../../client/foldkit/reader.ts";

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
    expect(opened.route._tag).toBe("Reader");
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
});
