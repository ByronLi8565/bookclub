// @vitest-environment jsdom

import { Runtime } from "foldkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTE_EDITOR_INPUT_CLASS } from "../../client/foldkit/mounts/lexical.ts";
import {
  CompletedImageAction,
  NotesModel,
  initialNotesModel,
  notesView,
  type NotesMessage,
  type NotesViewContext,
} from "../../client/foldkit/notes.ts";
import type { Highlight, Note } from "../../shared/types/notes.ts";
import {
  NOTE_IMAGE_TAG,
  registerNoteImageElement,
} from "../../client/logic/notes/noteImageElement.ts";

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

const reply: Note = {
  ...note,
  id: "note-2",
  seq: 2,
  parent: note.id,
  body: "a reply",
  highlights: [],
};

const online: NotesModel = {
  ...initialNotesModel(),
  ready: true,
  status: "online",
  notes: [note, reply],
  pendingNoteIds: [note.id],
  peers: [{ id: "reader-2", name: "Second Reader", role: "member" }],
};

const viewer = { userId: note.author.id, isOwner: false };

/**
 * `Runtime.embed` replaces the container element rather than filling it, so the
 * rendered tree lands in `document.body` and the container is left detached.
 * `dispose` tears that tree back down, so the DOM is captured before disposing.
 */
const render = async (
  model: NotesModel,
  context: Partial<NotesViewContext<NotesMessage>> = {},
): Promise<HTMLElement> => {
  const container = document.createElement("div");
  // The runtime mounts by container id; an id-less container is never replaced.
  container.id = "notes-view-test";
  document.body.appendChild(container);
  const handle = Runtime.embed(
    Runtime.makeElement<NotesModel, NotesMessage>({
      Model: NotesModel,
      container,
      init: () => [model, []],
      update: (current) => [current, []],
      view: (current, h) =>
        notesView(
          current,
          {
            sourceId: note.sourceId,
            groupRef: "club-alpha",
            viewer,
            avatarFor: (author) => ({ url: null, initials: "R", name: author.name }),
            ...context,
          },
          h,
        ),
      devTools: false,
      slow: false,
    }),
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  const html = document.body.innerHTML;
  handle.dispose();
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder;
};

const composing: NotesModel = { ...online, composing: true };

describe("Foldkit notes view", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("renders the panel React's stylesheet expects: an aside, its toolbar, and a list", async () => {
    const rendered = await render(online);
    const panel = rendered.querySelector("aside.note-panel");
    expect(panel).not.toBeNull();
    expect(panel?.querySelector(".note-panel-toolbar > h2.label")?.textContent).toBe("Notes");
    expect(panel?.querySelector("ul > li.note-thread")).not.toBeNull();
  });

  it("lays a note out as a card in the avatar's gutter", async () => {
    const rendered = await render(online);
    const row = rendered.querySelector("li.note-thread > .note-row");
    expect(row?.querySelector(".note-avatar")?.getAttribute("title")).toBe("Reader");
    const card = row?.querySelector(".note-row-body > .note-result > .note");
    expect(card?.getAttribute("id")).toBe("note-1");
    expect(card?.querySelector(".note-header > .note-head > .note-seq")?.textContent).toBe("1");
    expect(card?.querySelector(".note-head > button.quote.truncate")?.textContent).toContain(
      "Reader posted",
    );
    expect(card?.querySelector(".note-body")?.textContent).toContain("passage");
  });

  it("renders without the avatar gutter when the host resolves no avatar", async () => {
    const rendered = await render(online, { avatarFor: () => null });
    expect(rendered.querySelector(".note-row")).toBeNull();
    expect(rendered.querySelector("li.note-thread > .note-result > .note")).not.toBeNull();
  });

  it("indents a reply into the replies column rather than listing it at the top", async () => {
    const rendered = await render(online);
    expect(rendered.querySelectorAll("ul > li.note-thread")).toHaveLength(1);
    const replies = rendered.querySelector("li.note-thread > .replies");
    expect(replies?.querySelector(".note-body")?.textContent).toContain("a reply");
  });

  it("marks a deleted note rather than dropping it", async () => {
    const rendered = await render({
      ...online,
      notes: [{ ...note, deletedAt: "2026-08-16T00:00:00.000Z" }],
    });
    expect(rendered.querySelector(".note.note--deleted")).not.toBeNull();
    // A deleted note offers neither reply, edit, nor delete.
    expect(rendered.querySelector("button.reply")).toBeNull();
    expect(rendered.querySelector("button.edit")).toBeNull();
    expect(rendered.querySelector(".delete-wrap")).toBeNull();
  });

  it("renders a note's tags as filter chips", async () => {
    const rendered = await render(online);
    const tag = rendered.querySelector(".note-card-tags > .note-tags > .note-tag > button");
    expect(tag?.textContent).toBe("theme");
    expect(tag?.getAttribute("title")).toBe("Filter by theme");
    // A posted note's tags are not the composer's to edit.
    expect(rendered.querySelector(".note-card-tags .note-tag-remove")).toBeNull();
  });

  it("shows an unsynced note's state in the card's own chrome", async () => {
    const rendered = await render(online);
    const sync = rendered.querySelector(".note-head > .note-sync");
    expect(sync?.getAttribute("class")).toBe("note-sync note-sync--pending");
    expect(sync?.textContent).toContain("syncing");

    const failed = await render({ ...online, pendingNoteIds: [], failedNoteIds: [note.id] });
    const alert = failed.querySelector(".note-sync");
    expect(alert?.getAttribute("class")).toBe("note-sync note-sync--failed");
    expect(alert?.textContent).toContain("unsynced");
  });

  it("offers edit and delete only to a reader allowed to use them", async () => {
    const mine = await render(online);
    expect(mine.querySelector('button.edit[aria-label="edit"] svg')).not.toBeNull();
    expect(mine.querySelector('.delete-wrap > button.delete[aria-label="delete"]')).not.toBeNull();

    const theirs = await render(online, { viewer: { userId: "someone-else", isOwner: false } });
    expect(theirs.querySelector("button.edit")).toBeNull();
    expect(theirs.querySelector(".delete-wrap")).toBeNull();
    // Replying is open to everyone who can write.
    expect(theirs.querySelector('button.reply[aria-label="reply"]')).not.toBeNull();
  });

  it("asks before deleting, in a dialog the UA will actually show", async () => {
    const rendered = await render({ ...online, confirmingDeleteNoteId: note.id });
    const dialog = rendered.querySelector("dialog.delete-confirm");
    expect(dialog?.hasAttribute("open")).toBe(true);
    expect(dialog?.getAttribute("aria-label")).toBe("Confirm delete");
    expect(dialog?.querySelector("p")?.textContent).toBe("Really delete?");
    expect(
      dialog?.querySelectorAll('.delete-confirm-actions button[aria-label="confirm delete"]'),
    ).toHaveLength(1);
    expect(rendered.querySelector("button.delete")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the jump affordance as disabled when nothing anchors the note", async () => {
    const anchored = await render(online, { jumpToHighlight: () => CompletedImageAction() });
    expect(anchored.querySelector("button.quote.truncate")?.hasAttribute("disabled")).toBe(false);
    expect(anchored.querySelector("button.quote.truncate")?.getAttribute("title")).toBe(
      "Jump to highlight",
    );

    const unanchored = await render({ ...online, notes: [{ ...note, highlights: [] }] });
    expect(unanchored.querySelector("button.quote.truncate")?.hasAttribute("disabled")).toBe(true);
  });

  it("posts a new note from the composer at the end of the list", async () => {
    const rendered = await render(composing);
    const compose = rendered.querySelector("ul > li.note.compose > .note-editor");
    expect(compose).not.toBeNull();
    expect(compose?.querySelector(".note-editor-actions > button.primary")?.textContent).toBe(
      "Publish",
    );
    expect(
      rendered.querySelector(".note-editor-actions > button.primary")?.getAttribute("title"),
    ).toBe("Publish (⌘↵)");
  });

  it("edits a note in place, with the composer inside the note's own card", async () => {
    const rendered = await render({ ...online, editingNoteId: note.id, draft: "passage" });
    const editing = rendered.querySelector(".note-row-body > .note.editing");
    expect(editing?.querySelector(".note-head > button.quote.truncate")?.textContent).toContain(
      "(editing)",
    );
    expect(
      editing?.querySelector(".note-editor > .note-editor-actions > button.primary")?.textContent,
    ).toBe("Save");
    expect(rendered.querySelector("li.note.compose")).toBeNull();
  });

  it("replies under the note being answered", async () => {
    const rendered = await render({ ...online, replyingToNoteId: note.id });
    const composer = rendered.querySelector(".note-result > .note.reply-compose > .note-editor");
    expect(composer?.querySelector("button.primary")?.textContent).toBe("Reply");
    expect(rendered.querySelector("li.note.compose")).toBeNull();
  });

  it("mounts the Lexical composer seeded from the draft rather than a textarea", async () => {
    const rendered = await render({ ...composing, draft: "passage" });
    const editor = rendered.querySelector(`.${NOTE_EDITOR_INPUT_CLASS}`);
    expect(editor?.getAttribute("contenteditable")).toBe("true");
    expect(editor?.getAttribute("role")).toBe("textbox");
    expect(editor?.textContent).toContain("passage");
    expect(rendered.querySelector("textarea")).toBeNull();
  });

  it("refuses to submit an empty draft, and one whose images have not settled", async () => {
    const empty = await render({ ...composing, draft: "   " });
    expect(empty.querySelector("button.primary")?.hasAttribute("disabled")).toBe(true);

    const unresolved = await render({ ...composing, draft: "a note", unresolvedImages: 1 });
    expect(unresolved.querySelector("button.primary")?.hasAttribute("disabled")).toBe(true);
    expect(unresolved.querySelector(".note-editor-hint")?.textContent).toContain(
      "Finish or remove image uploads",
    );
  });

  it("shows the draft's own tags as removable chips above the editor", async () => {
    const rendered = await render({ ...composing, draftTags: ["theme"] });
    const chip = rendered.querySelector(
      ".note-editor-header > .note-tags.note-tags--editable > .note-tag",
    );
    expect(
      chip?.querySelector('button.note-tag-remove[aria-label="Remove #theme"]'),
    ).not.toBeNull();
  });

  it("says the panel is loading, and what an empty panel means", async () => {
    const loading = await render({ ...online, ready: false, notes: [] });
    expect(
      loading.querySelector("output.loading.loading--note-panel")?.getAttribute("aria-label"),
    ).toBe("Loading");

    const empty = await render({ ...online, notes: [] });
    expect(empty.querySelector("p.empty")?.textContent).toBe("Select text to add a note.");

    const filtered = await render({
      ...online,
      notes: [],
      filterTerms: [{ kind: "tag", value: "missing", negated: false }],
    });
    expect(filtered.querySelector("p.empty")?.textContent).toBe("No notes match these filters.");
  });

  it("renders the filter bar with its scope, chips, suggestions, and status", async () => {
    const rendered = await render({
      ...online,
      scope: "all-books",
      filterInput: "read",
      filterTerms: [
        { kind: "tag", value: "theme", negated: true },
        { kind: "property", property: "type", value: "note", negated: false },
      ],
    });
    const bar = rendered.querySelector(".note-filter-bar.note-filter-bar--active");
    expect(bar).not.toBeNull();

    const scope = bar?.querySelectorAll(".note-scope > button");
    expect(scope?.[0]?.className).not.toContain("active");
    expect(scope?.[1]?.getAttribute("class")).toBe("active");

    const chips = bar?.querySelectorAll(".note-filter-terms > .note-filter-chip");
    expect(chips?.[0]?.getAttribute("class")).toBe("note-filter-chip excluded");
    expect(chips?.[0]?.querySelector("button")?.textContent).toBe("Not theme");
    expect(chips?.[1]?.querySelectorAll("button")[1]?.getAttribute("aria-label")).toBe(
      "Remove Type: Note filter",
    );

    const entry = bar?.querySelector(".note-filter-entry");
    expect(entry?.querySelector("input")?.getAttribute("aria-label")).toBe("Filter notes");
    const suggestion = entry?.querySelector(".note-filter-suggestions > button");
    expect(suggestion?.querySelector("span")?.textContent).toBe("Authors");
    expect(suggestion?.textContent).toContain("Reader");
    expect(bar?.querySelector(".note-filter-status > button")?.textContent).toBe("Clear");
  });

  it("hides the suggestion list until something is typed", async () => {
    const rendered = await render(online);
    expect(rendered.querySelector(".note-filter-suggestions")).toBeNull();
  });

  it("names the book a note belongs to once the panel is looking at them all", async () => {
    const rendered = await render(
      { ...online, scope: "all-books" },
      { bookTitles: new Map([[note.sourceId, "Middlemarch"]]) },
    );
    const property = rendered.querySelector(".note-metadata > button.note-book-property");
    expect(property?.textContent).toBe("Middlemarch");
    expect(property?.getAttribute("title")).toBe("Filter by book");
  });

  it("dims a note that only survived the filter as context for a match", async () => {
    const rendered = await render({
      ...online,
      notes: [note, { ...reply, tags: ["reply-only"] }],
      filterTerms: [{ kind: "tag", value: "reply-only", negated: false }],
    });
    expect(rendered.querySelector(".note-result--context .note")?.getAttribute("id")).toBe(
      "note-1",
    );
  });

  it("renders an image block in a posted note as the read-only widget", async () => {
    registerNoteImageElement();
    const imageId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const rendered = await render({
      ...online,
      notes: [{ ...note, body: `look\n\n[[image:${imageId}:60]]`, highlights: [] }],
    });

    const widget = rendered.querySelector(NOTE_IMAGE_TAG);
    expect(widget).not.toBeNull();
    expect(rendered.textContent).toContain("look");
    // The block's own text never reaches the reader.
    expect(rendered.textContent).not.toContain("[[image:");
    // Foldkit writes JS properties, so what is observable in the rendered
    // markup is what the widget did with them.
    expect(widget?.getAttribute("style")).toContain("60%");
    expect(widget?.querySelector("img")?.getAttribute("src")).toBe(
      `/groups/club-alpha/images/${imageId}`,
    );
    // A posted note offers no editing chrome.
    expect(widget?.querySelector('button[aria-label="Remove image"]')?.hasAttribute("hidden")).toBe(
      true,
    );
  });
});
