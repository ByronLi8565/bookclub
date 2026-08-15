// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  NOTE_IMAGE_REMOVED,
  NOTE_IMAGE_RESIZED,
  NOTE_IMAGE_RETRIED,
  NOTE_IMAGE_TAG,
  registerNoteImageElement,
  type NoteImageWidget,
} from "../../client/logic/notes/noteImageElement.ts";
import { MAX_NOTE_IMAGE_WIDTH, MIN_NOTE_IMAGE_WIDTH } from "../../shared/notes/images.ts";

registerNoteImageElement();

/** The widget is a real custom element, so its interactive chrome is checkable
 *  under jsdom — which the React decorator it replaces never was. */
const mount = (properties: Partial<NoteImageWidget> = {}): NoteImageWidget => {
  const track = document.createElement("div");
  Object.defineProperty(track, "clientWidth", { value: 200, configurable: true });
  document.body.appendChild(track);
  // SAFETY: the registered `<note-image>` element implements this contract.
  const widget = document.createElement(NOTE_IMAGE_TAG) as NoteImageWidget;
  track.appendChild(widget);
  Object.assign(widget, { imageId: "image-1", src: "/groups/club/images/image-1", ...properties });
  return widget;
};

const control = (widget: NoteImageWidget, label: string): HTMLButtonElement => {
  const found = widget.querySelector(`button[aria-label="${label}"], button`);
  const button = [...widget.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent === label,
  );
  if (!button) throw new Error(`${label} is not rendered: ${found?.outerHTML ?? "no buttons"}`);
  return button;
};

const emitted = (widget: NoteImageWidget, type: string): unknown[] => {
  const details: unknown[] = [];
  widget.addEventListener(type, (event) => {
    // SAFETY: the widget dispatches these three names as CustomEvents only.
    details.push((event as CustomEvent).detail);
  });
  return details;
};

const pointer = (type: string, clientX: number): PointerEvent => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { clientX: { value: clientX }, pointerId: { value: 1 } });
  // SAFETY: the widget's handlers read only pointerId and clientX.
  return event as PointerEvent;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("note image widget", () => {
  it("shows the image at the width it is given", () => {
    const widget = mount({ width: 60 });
    expect(widget.style.width).toBe("60%");
    expect(widget.querySelector("img")?.getAttribute("src")).toBe("/groups/club/images/image-1");
    expect(widget.className).toContain("note-editor-image--ready");
  });

  it("reports a drag as one resize, at the width the drag ended on", () => {
    const widget = mount({ width: 100 });
    const resizes = emitted(widget, NOTE_IMAGE_RESIZED);
    const handle = control(widget, "Resize image");
    // A 200px track: dragging 60px left is 30% narrower.
    handle.dispatchEvent(pointer("pointerdown", 100));
    handle.dispatchEvent(pointer("pointermove", 40));

    // Mid-drag the widget shows the new width without reporting it.
    expect(widget.style.width).toBe("70%");
    expect(resizes).toEqual([]);

    handle.dispatchEvent(pointer("pointerup", 40));
    expect(resizes).toEqual([{ imageId: "image-1", width: 70 }]);
  });

  it("resizes by keyboard and never leaves the allowed range", () => {
    const widget = mount({ width: MIN_NOTE_IMAGE_WIDTH });
    const resizes = emitted(widget, NOTE_IMAGE_RESIZED);
    const handle = control(widget, "Resize image");

    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(resizes.at(-1)).toEqual({ imageId: "image-1", width: MIN_NOTE_IMAGE_WIDTH });

    widget.width = MAX_NOTE_IMAGE_WIDTH;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(resizes.at(-1)).toEqual({ imageId: "image-1", width: MAX_NOTE_IMAGE_WIDTH });

    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(resizes.at(-1)).toEqual({ imageId: "image-1", width: MAX_NOTE_IMAGE_WIDTH - 5 });
  });

  it("asks to be removed", () => {
    const widget = mount();
    const removals = emitted(widget, NOTE_IMAGE_REMOVED);
    control(widget, "Remove image").click();
    expect(removals).toEqual([{ imageId: "image-1" }]);
  });

  it("offers a retry only while an upload has failed", () => {
    const widget = mount({ imageId: "", src: "blob:preview", status: "uploading" });
    expect(widget.textContent).toContain("uploading image...");
    expect(control(widget, "Retry").hidden).toBe(true);

    widget.status = "failed";
    expect(widget.textContent).toContain("upload failed");
    const retries = emitted(widget, NOTE_IMAGE_RETRIED);
    control(widget, "Retry").click();
    expect(retries).toEqual([{ imageId: "" }]);

    widget.status = "ready";
    expect(control(widget, "Retry").hidden).toBe(true);
  });

  it("says so when there is no image to show", () => {
    const widget = mount({ src: "" });
    expect(widget.querySelector("img")).toBeNull();
    expect(widget.textContent).toContain("image unavailable");
  });
});
