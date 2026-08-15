// @vitest-environment jsdom

import { Runtime } from "foldkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTE_EDITOR_INPUT_CLASS } from "../../client/foldkit/mounts/lexical.ts";
import {
  NotesModel,
  initialNotesModel,
  notesView,
  type NotesMessage,
  type ReaderSelection,
} from "../../client/foldkit/notes.ts";
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
  draftHighlights: [highlight],
};

/**
 * `Runtime.embed` replaces the container element rather than filling it, so the
 * rendered tree lands in `document.body` and the container is left detached.
 * `dispose` tears that tree back down, so the DOM is captured before disposing.
 */
const render = async (
  model: NotesModel,
  selection: ReaderSelection | null = null,
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
        notesView(current, { sourceId: note.sourceId, groupRef: "club-alpha", selection }, h),
      devTools: false,
      slow: false,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  const html = document.body.innerHTML;
  handle.dispose();
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder;
};

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

  it("renders the authoritative list, its replies, presence, and pending state", async () => {
    const rendered = await render(online);
    expect(rendered.textContent).toContain("passage");
    expect(rendered.textContent).toContain("a reply");
    expect(rendered.textContent).toContain("Second Reader");
    expect(rendered.textContent).toContain("Sending");
  });

  it("renders a reply nested under its parent rather than at the top level", async () => {
    const rendered = await render(online);
    const roots = rendered.querySelectorAll('ul[aria-label="Notes"] > li');
    expect(roots).toHaveLength(1);
    expect(roots[0]?.textContent).toContain("a reply");
  });

  it("hides deleted notes", async () => {
    const rendered = await render({
      ...online,
      notes: [{ ...note, deletedAt: "2026-08-16T00:00:00.000Z" }],
    });
    expect(rendered.querySelector('ul[aria-label="Notes"]')?.textContent).toBe("");
  });

  it("labels the composer for a new note", async () => {
    const rendered = await render(online);
    expect(rendered.textContent).toContain("Post note");
    expect(rendered.textContent).not.toContain("Cancel");
  });

  it("labels the composer for an edit in flight", async () => {
    const rendered = await render({ ...online, editingNoteId: note.id, draft: "passage" });
    expect(rendered.textContent).toContain("Save note");
    expect(rendered.textContent).toContain("Cancel");
  });

  it("mounts the Lexical composer seeded from the draft rather than a textarea", async () => {
    const rendered = await render({ ...online, editingNoteId: note.id, draft: "passage" });
    const editor = rendered.querySelector(`.${NOTE_EDITOR_INPUT_CLASS}`);
    expect(editor?.getAttribute("contenteditable")).toBe("true");
    expect(editor?.getAttribute("role")).toBe("textbox");
    expect(editor?.textContent).toContain("passage");
    expect(rendered.querySelector("textarea")).toBeNull();
  });

  it("refuses to submit an empty draft", async () => {
    const rendered = await render({ ...online, draft: "   " });
    const submit = rendered.querySelector('button[type="submit"]');
    expect(submit?.hasAttribute("disabled")).toBe(true);
  });

  it("offers to quote a live reader selection", async () => {
    const rendered = await render(
      { ...online, draftHighlights: [] },
      {
        anchor: { kind: "epub-cfi", value: "epubcfi(/6/8)" },
        quote: { type: "TextQuoteSelector", exact: "a fresh passage", prefix: "", suffix: "" },
      },
    );
    expect(rendered.textContent).toContain("Quote this passage");
  });

  it("does not re-offer a selection the draft already quotes", async () => {
    const rendered = await render(online, { anchor: highlight.anchor, quote: highlight.quote });
    expect(rendered.textContent).not.toContain("Quote this passage");
  });

  it("lists the quoted passages already attached to the draft", async () => {
    const rendered = await render(online);
    const quotes = rendered.querySelectorAll('ul[aria-label="Quoted passages"] > li');
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.textContent).toContain("passage");
    expect(quotes[0]?.textContent).toContain("Remove quote");
  });

  it("reports a sync failure through the alert channel", async () => {
    const rendered = await render({ ...online, status: "offline", error: "socket refused" });
    expect(rendered.querySelector('[role="alert"]')?.textContent).toContain("socket refused");
  });
});
