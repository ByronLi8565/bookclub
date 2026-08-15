import { clampNoteImageWidth, DEFAULT_NOTE_IMAGE_WIDTH } from "../../../shared/notes/images.ts";

export const NOTE_IMAGE_TAG = "note-image";

export const NOTE_IMAGE_RESIZED = "image-resized";
export const NOTE_IMAGE_REMOVED = "image-removed";
export const NOTE_IMAGE_RETRIED = "image-retried";

export type NoteImageStatus = "uploading" | "failed" | "ready";

const WIDTH_KEY_STEP = 5;

/** The widget's property contract, which is what both clients write. */
export interface NoteImageWidget extends HTMLElement {
  imageId: string;
  src: string;
  width: number;
  status: NoteImageStatus;
  /** A posted note shows the picture only; the chrome belongs to editing. */
  readOnly: boolean;
}

/**
 * The note image widget: one picture with a remove button, a resize handle, and
 * the state of its upload. It owns its own DOM and reports what the reader did
 * as `CustomEvent`s, which is the boundary both an editor node and a view can
 * meet it at — Lexical writes its properties from `createDOM`/`updateDOM`, and
 * Foldkit binds the same properties and events declaratively.
 *
 * Deliberately framework-free, and defined lazily: `HTMLElement` does not exist
 * in the Worker or in a Node test, and this module is imported by both.
 */
const defineNoteImageElement = (): CustomElementConstructor =>
  class NoteImageElement extends HTMLElement {
    #imageId = "";
    #src = "";
    #width = DEFAULT_NOTE_IMAGE_WIDTH;
    #status: NoteImageStatus = "ready";
    #readOnly = false;
    /** The width being dragged, which is shown but not yet reported. */
    #draggingWidth: number | null = null;
    #drag: { pointerId: number; startX: number; startWidth: number; trackWidth: number } | null =
      null;
    #built = false;

    #picture = document.createElement("img");
    #missing = document.createElement("div");
    #caption = document.createElement("figcaption");
    #captionText = document.createElement("span");
    #retry = document.createElement("button");
    #size = document.createElement("span");
    #remove = document.createElement("button");
    #resize = document.createElement("button");

    get imageId(): string {
      return this.#imageId;
    }
    set imageId(value: string) {
      this.#imageId = value;
      this.#render();
    }

    get src(): string {
      return this.#src;
    }
    set src(value: string) {
      this.#src = value;
      this.#render();
    }

    get width(): number {
      return this.#width;
    }
    set width(value: number) {
      this.#width = clampNoteImageWidth(value);
      this.#render();
    }

    get status(): NoteImageStatus {
      return this.#status;
    }
    set status(value: NoteImageStatus) {
      this.#status = value;
      this.#render();
    }

    get readOnly(): boolean {
      return this.#readOnly;
    }
    set readOnly(value: boolean) {
      this.#readOnly = value;
      this.#render();
    }

    connectedCallback(): void {
      this.#build();
      this.#render();
    }

    #build(): void {
      if (this.#built) return;
      this.#built = true;
      // The editor treats the widget as one atomic thing rather than as text.
      this.setAttribute("contenteditable", "false");
      // A custom element is inline by default, which would leave the absolutely
      // positioned chrome measuring against an ancestor instead of the picture.
      this.style.display = "block";

      this.#picture.alt = "";
      this.#missing.className = "note-editor-image-missing";
      this.#missing.textContent = "image unavailable";

      this.#remove.type = "button";
      this.#remove.className = "note-editor-image-remove";
      this.#remove.textContent = "X";
      this.#remove.title = "Remove image";
      this.#remove.setAttribute("aria-label", "Remove image");
      this.#remove.addEventListener("click", (event) => {
        event.preventDefault();
        this.#emit(NOTE_IMAGE_REMOVED, { imageId: this.#imageId });
      });

      this.#resize.type = "button";
      this.#resize.className = "note-editor-image-resize";
      this.#resize.title = "Resize image";
      this.#resize.setAttribute("aria-label", "Resize image");
      this.#resize.addEventListener("pointerdown", (event) => this.#startDrag(event));
      this.#resize.addEventListener("pointermove", (event) => this.#moveDrag(event));
      this.#resize.addEventListener("pointerup", (event) => this.#endDrag(event));
      this.#resize.addEventListener("pointercancel", () => this.#cancelDrag());
      this.#resize.addEventListener("keydown", (event) => this.#resizeByKey(event));

      this.#size.className = "note-editor-image-size";

      this.#retry.type = "button";
      this.#retry.textContent = "Retry";
      this.#retry.addEventListener("click", (event) => {
        event.preventDefault();
        this.#emit(NOTE_IMAGE_RETRIED, { imageId: this.#imageId });
      });
      // `appendChild` rather than `append`: the Worker runtime's HTMLRewriter
      // `Element` shares the name with a different signature, and this module is
      // typechecked against both lib sets.
      this.#caption.appendChild(this.#captionText);
      this.#caption.appendChild(this.#retry);
      for (const child of [this.#remove, this.#picture, this.#caption, this.#size, this.#resize]) {
        this.appendChild(child);
      }
    }

    #render(): void {
      if (!this.#built) return;
      const width = this.#draggingWidth ?? this.#width;
      this.className = `note-editor-image note-editor-image--${this.#status}`;
      this.style.width = `${width}%`;

      if (this.#src === "") {
        this.#picture.remove();
        if (!this.#missing.isConnected) this.insertBefore(this.#missing, this.#caption);
      } else {
        this.#missing.remove();
        if (this.#picture.src !== this.#src) this.#picture.src = this.#src;
        if (!this.#picture.isConnected) this.insertBefore(this.#picture, this.#caption);
      }

      this.#remove.hidden = this.#readOnly;
      this.#resize.hidden = this.#readOnly;
      this.#caption.hidden = this.#readOnly || this.#status === "ready";
      this.#captionText.textContent =
        this.#status === "uploading" ? "uploading image..." : "upload failed";
      this.#retry.hidden = this.#status !== "failed";

      this.#size.hidden = this.#readOnly || this.#draggingWidth === null;
      this.#size.textContent = `${width}%`;
      this.#resize.title = `Resize image (${width}%)`;
    }

    #trackWidth(): number {
      return this.parentElement?.clientWidth || 1;
    }

    #startDrag(event: PointerEvent): void {
      event.preventDefault();
      event.stopPropagation();
      // Capture keeps the drag alive past the handle's own bounds where the
      // browser supports it; without it the drag still tracks over the handle.
      this.#resize.setPointerCapture?.(event.pointerId);
      this.#drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: this.#width,
        trackWidth: this.#trackWidth(),
      };
      this.#draggingWidth = this.#width;
      this.#render();
    }

    #moveDrag(event: PointerEvent): void {
      const drag = this.#drag;
      if (drag === null) return;
      const delta = ((event.clientX - drag.startX) / drag.trackWidth) * 100;
      this.#draggingWidth = clampNoteImageWidth(drag.startWidth + delta);
      this.#render();
    }

    #endDrag(event: PointerEvent): void {
      const drag = this.#drag;
      if (drag === null) return;
      if (this.#resize.hasPointerCapture?.(drag.pointerId) === true) {
        this.#resize.releasePointerCapture(drag.pointerId);
      }
      const width = this.#draggingWidth ?? this.#width;
      this.#drag = null;
      this.#draggingWidth = null;
      event.preventDefault();
      this.#commitWidth(width);
    }

    #cancelDrag(): void {
      this.#drag = null;
      this.#draggingWidth = null;
      this.#render();
    }

    #resizeByKey(event: KeyboardEvent): void {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      this.#commitWidth(
        this.#width + (event.key === "ArrowRight" ? WIDTH_KEY_STEP : -WIDTH_KEY_STEP),
      );
    }

    /** The widget shows the new width at once; whoever owns the document decides
     *  whether it sticks, and writes the property back. */
    #commitWidth(width: number): void {
      const clamped = clampNoteImageWidth(width);
      this.#width = clamped;
      this.#render();
      this.#emit(NOTE_IMAGE_RESIZED, { imageId: this.#imageId, width: clamped });
    }

    #emit(name: string, detail: Record<string, unknown>): void {
      this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }
  };

export function registerNoteImageElement(): void {
  if (globalThis.customElements?.get(NOTE_IMAGE_TAG) === undefined) {
    globalThis.customElements?.define(NOTE_IMAGE_TAG, defineNoteImageElement());
  }
}
