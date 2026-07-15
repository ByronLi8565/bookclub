// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "../client/ui/notes/editor/NoteEditor.tsx";
import type { UploadedNoteImage } from "../client/ui/notes/editor/NoteImageNode.tsx";

const IMAGE_ID = "01JH0000000000000000000000";

describe("NoteEditor markdown", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = window.document.createElement("div");
    window.document.documentElement.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders and preserves highlights", async () => {
    const save = vi.fn();
    await act(() =>
      root.render(
        <NoteEditor
          initialBody="A ==highlighted passage== here"
          submitLabel="Save"
          onSave={save}
          onCancel={vi.fn()}
          validSeqs={new Set()}
        />,
      ),
    );

    expect(container.querySelector(".bc-highlight")?.textContent).toBe("highlighted passage");
    expect(container.querySelector(".note-editor-input")?.textContent).not.toContain("==");

    await act(() => container.querySelector<HTMLButtonElement>("button.primary")?.click());
    expect(save).toHaveBeenCalledWith("A ==highlighted passage== here");
  });
});

describe("NoteEditor images", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = window.document.createElement("div");
    window.document.documentElement.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders saved images instead of their markdown token", async () => {
    const save = vi.fn();
    await act(() =>
      root.render(
        <NoteEditor
          initialBody={`[[image:${IMAGE_ID}]]`}
          submitLabel="Save"
          onSave={save}
          onCancel={vi.fn()}
          validSeqs={new Set()}
          imageUrlBase="/images"
        />,
      ),
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(`/images/${IMAGE_ID}`);
    expect(container.textContent).not.toContain(IMAGE_ID);

    await act(async () => {
      container
        .querySelector("[aria-label='Resize image']")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    await act(() => container.querySelector<HTMLButtonElement>("button.primary")?.click());
    expect(save).toHaveBeenCalledWith(`[[image:${IMAGE_ID}:95]]`);
  });

  it("shows a local preview immediately and blocks saving until upload completes", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(vi.fn());
    let finishUpload: ((image: UploadedNoteImage) => void) | undefined;
    const upload = vi.fn(
      () =>
        new Promise<UploadedNoteImage>((resolve) => {
          finishUpload = resolve;
        }),
    );

    await act(() =>
      root.render(
        <NoteEditor
          initialBody=""
          submitLabel="Publish"
          onSave={vi.fn()}
          onCancel={vi.fn()}
          onPasteImage={upload}
          validSeqs={new Set()}
          imageUrlBase="/images"
        />,
      ),
    );

    const file = new File(["image"], "image.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        files: [file],
        getData: () => "",
        items: [{ kind: "file", type: file.type, getAsFile: () => file }],
        types: ["Files"],
      },
    });
    await act(async () => {
      container.querySelector(".note-editor")?.dispatchEvent(paste);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:preview");
    expect(container.querySelector<HTMLButtonElement>("button.primary")?.disabled).toBe(true);

    const discard = vi.fn(() => Promise.resolve());
    await act(async () => {
      finishUpload?.({ id: IMAGE_ID, discard });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(container.querySelector<HTMLButtonElement>("button.primary")?.disabled).toBe(false);

    const remove = container.querySelector<HTMLButtonElement>("[aria-label='Remove image']");
    await act(async () => {
      remove?.click();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(discard).toHaveBeenCalledOnce();
    expect(container.querySelector(".note-editor-image")).toBeNull();
  });
});
