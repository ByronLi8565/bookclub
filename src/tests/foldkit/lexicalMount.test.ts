// @vitest-environment jsdom
// oxlint-disable no-underscore-dangle

import { Effect, Fiber, Schema, Stream } from "effect";
import { Runtime } from "foldkit";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTE_EDITOR_INPUT_CLASS,
  NoteDraftEditor,
  type NoteEditorMessage,
} from "../../client/foldkit/mounts/lexical.ts";

interface EditorArgs {
  initialBody: string;
  validSeqs: readonly number[];
  groupRef: string;
  imageUrlBase: string;
  extractHashtags: boolean;
}

const defaultArgs: EditorArgs = {
  initialBody: "",
  validSeqs: [],
  groupRef: "g1",
  imageUrlBase: "/groups/g1/images",
  extractHashtags: false,
};

interface LexicalHost {
  __lexicalEditor?: LexicalEditor;
}

const mountEditor = (element: Element, args: Partial<typeof defaultArgs> = {}) => {
  const messages: NoteEditorMessage[] = [];
  const fiber = Effect.runFork(
    Stream.runForEach(NoteDraftEditor({ ...defaultArgs, ...args }).f(element), (message) =>
      Effect.sync(() => {
        messages.push(message);
      }),
    ),
  );
  return {
    messages,
    drafts: () => messages.filter((message) => message._tag === "ChangedNoteDraft"),
    release: () => Effect.runPromise(Fiber.interrupt(fiber)),
  };
};

/**
 * jsdom has no ClipboardEvent, so the paste is dispatched as a plain Event
 * carrying the `clipboardData` shape the listener reads. Returns whether the
 * default was prevented.
 */
const pasteInto = (element: Element, files: readonly File[]): (() => boolean) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const items = files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file }));
  Object.defineProperty(event, "clipboardData", { value: { items } });
  element.dispatchEvent(event);
  return () => event.defaultPrevented;
};

const attachedEditor = (element: Element): LexicalEditor => {
  // SAFETY: Lexical stores the attached editor on its root element; absence is handled below.
  const editor = (element as LexicalHost).__lexicalEditor;
  if (!editor) throw new Error("no editor attached to the mounted element");
  return editor;
};

const writeBody = (editor: LexicalEditor, text: string): void => {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(text));
      root.append(paragraph);
      paragraph.selectEnd();
    },
    { discrete: true },
  );
};

describe("Lexical Mount", () => {
  let element: HTMLElement;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
    );
    element = document.createElement("div");
    document.body.appendChild(element);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("acquires an editor seeded with the initial draft", async () => {
    const mounted = mountEditor(element, { initialBody: "> quoted\n\nplain body" });

    await vi.waitFor(() => expect(mounted.drafts()).not.toHaveLength(0));
    expect(mounted.drafts().at(-1)).toMatchObject({ body: "> quoted\n\nplain body", imageIds: [] });
    expect(element.classList.contains(NOTE_EDITOR_INPUT_CLASS)).toBe(true);
    expect(element.getAttribute("contenteditable")).toBe("true");
    await vi.waitFor(() =>
      expect(mounted.messages.some((message) => message._tag === "ChangedNoteDraftSelection")).toBe(
        true,
      ),
    );

    await mounted.release();
  });

  it("publishes a draft event for each edit, including its image references", async () => {
    const imageId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const mounted = mountEditor(element, { initialBody: `[[image:${imageId}:50]]` });
    await vi.waitFor(() => expect(mounted.drafts()).not.toHaveLength(0));
    expect(mounted.drafts().at(-1)).toMatchObject({
      body: `[[image:${imageId}:50]]`,
      imageIds: [imageId],
    });

    writeBody(attachedEditor(element), "an edited note");

    await vi.waitFor(() =>
      expect(mounted.drafts().at(-1)).toMatchObject({ body: "an edited note", imageIds: [] }),
    );

    await mounted.release();
  });

  it("extracts completed hashtags out of the draft when asked", async () => {
    const mounted = mountEditor(element, { extractHashtags: true });
    await vi.waitFor(() => expect(mounted.drafts()).not.toHaveLength(0));

    writeBody(attachedEditor(element), "a thought ##idea ");

    await vi.waitFor(() =>
      expect(
        mounted.messages.find((message) => message._tag === "ExtractedNoteDraftTags"),
      ).toMatchObject({ tags: ["idea"] }),
    );
    expect(mounted.drafts().at(-1)?.body).toBe("a thought");

    await mounted.release();
  });

  it("releases the editor listeners and DOM ownership on teardown", async () => {
    const mounted = mountEditor(element, { initialBody: "before teardown" });
    await vi.waitFor(() => expect(mounted.drafts()).not.toHaveLength(0));
    const editor = attachedEditor(element);

    await mounted.release();

    expect(element.classList.contains(NOTE_EDITOR_INPUT_CLASS)).toBe(false);
    expect(element.getAttribute("contenteditable")).toBeNull();
    // SAFETY: reading the same Lexical-owned root element property the editor sets on attach.
    expect((element as LexicalHost).__lexicalEditor).toBeFalsy();

    const published = mounted.messages.length;
    writeBody(editor, "after teardown");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(mounted.messages).toHaveLength(published);
  });

  it("reports a pasted image as a fact and keeps it out of the document", async () => {
    const mounted = mountEditor(element, { groupRef: "club-alpha" });
    await vi.waitFor(() => expect(mounted.drafts()).not.toHaveLength(0));
    const file = new File([Uint8Array.from([1, 2, 3])], "shot.png", { type: "image/png" });

    const prevented = pasteInto(element, [file]);

    await vi.waitFor(() =>
      expect(mounted.messages.filter((message) => message._tag === "PastedNoteImage")).toHaveLength(
        1,
      ),
    );
    const pasted = mounted.messages.find((message) => message._tag === "PastedNoteImage");
    expect(pasted).toMatchObject({ groupRef: "club-alpha", file });
    // Without this the editor also drops the raw clipboard payload into the note.
    expect(prevented()).toBe(true);

    await mounted.release();
  });

  it("ignores a paste that carries no image", async () => {
    const mounted = mountEditor(element);
    await vi.waitFor(() => expect(mounted.drafts()).not.toHaveLength(0));

    const prevented = pasteInto(element, []);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(mounted.messages.some((message) => message._tag === "PastedNoteImage")).toBe(false);
    // Ordinary text paste must still reach Lexical.
    expect(prevented()).toBe(false);

    await mounted.release();
  });

  it("stops reporting pastes once the editor is released", async () => {
    const mounted = mountEditor(element);
    await vi.waitFor(() => expect(mounted.drafts()).not.toHaveLength(0));
    await mounted.release();

    pasteInto(element, [new File([Uint8Array.from([1])], "shot.png", { type: "image/png" })]);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(mounted.messages.some((message) => message._tag === "PastedNoteImage")).toBe(false);
  });

  it("reports a failed initialization and still releases what it acquired", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    const mounted = mountEditor(svg, { initialBody: "unreachable" });

    await vi.waitFor(() =>
      expect(mounted.messages.find((message) => message._tag === "FailedNoteEditor")).toMatchObject(
        { message: "the note editor requires an HTML element root" },
      ),
    );
    expect(mounted.drafts()).toHaveLength(0);
    expect(svg.classList.contains(NOTE_EDITOR_INPUT_CLASS)).toBe(true);

    await mounted.release();

    expect(svg.classList.contains(NOTE_EDITOR_INPUT_CLASS)).toBe(false);
  });

  it("feeds draft events into a Foldkit application and releases on dispose", async () => {
    const Model = Schema.Struct({ draft: Schema.String });
    type Model = typeof Model.Type;
    type Message = NoteEditorMessage;
    const container = document.createElement("div");
    container.id = "foldkit-lexical-mount-test";
    document.body.appendChild(container);

    const handle = Runtime.embed(
      Runtime.makeElement<Model, Message>({
        Model,
        container,
        init: () => [{ draft: "" }, []],
        update: (model, message) => [
          message._tag === "ChangedNoteDraft" ? { draft: message.body } : model,
          [],
        ],
        view: (model, h) =>
          h.main(
            [],
            [
              h.div(
                [h.OnMount(NoteDraftEditor({ ...defaultArgs, initialBody: "hello notes" }))],
                [],
              ),
              h.p([], [model.draft]),
            ],
          ),
        devTools: false,
        slow: false,
      }),
    );

    const draft = () => document.querySelector("p")?.textContent;
    await vi.waitFor(() => expect(draft()).toBe("hello notes"));

    const mounted = document.querySelector(`.${NOTE_EDITOR_INPUT_CLASS}`);
    if (!mounted) throw new Error("the mount never attached to an element");
    writeBody(attachedEditor(mounted), "typed into the editor");
    await vi.waitFor(() => expect(draft()).toBe("typed into the editor"));

    handle.dispose();
    await vi.waitFor(() => expect(mounted.classList.contains(NOTE_EDITOR_INPUT_CLASS)).toBe(false));
  });
});
