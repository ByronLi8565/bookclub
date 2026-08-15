import { Schema } from "effect";
import { CustomElement } from "foldkit";
import {
  NOTE_IMAGE_REMOVED,
  NOTE_IMAGE_RESIZED,
  NOTE_IMAGE_RETRIED,
  NOTE_IMAGE_TAG,
} from "../logic/notes/noteImageElement.ts";

export const NoteImageStatus = Schema.Literals(["uploading", "failed", "ready"]);
export type NoteImageStatus = typeof NoteImageStatus.Type;

/**
 * The typed binding for the `<note-image>` widget: properties in, `CustomEvent`s
 * out. A view renders it through `noteImage.withMessage(h)`; the Lexical Mount
 * writes the same properties imperatively from `createDOM`/`updateDOM`, so both
 * clients drive one widget with one contract.
 */
export const noteImage = CustomElement.define({
  tag: NOTE_IMAGE_TAG,
  properties: {
    imageId: Schema.String,
    src: Schema.String,
    width: Schema.Number,
    status: NoteImageStatus,
    readOnly: Schema.Boolean,
  },
  events: {
    [NOTE_IMAGE_RESIZED]: Schema.Struct({ imageId: Schema.String, width: Schema.Number }),
    [NOTE_IMAGE_REMOVED]: Schema.Struct({ imageId: Schema.String }),
    [NOTE_IMAGE_RETRIED]: Schema.Struct({ imageId: Schema.String }),
  },
});
