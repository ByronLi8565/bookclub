import { Effect, Option, Stream } from "effect";
import { Multipart } from "effect/unstable/http";
import { BadRequest } from "../../shared/http/errors.ts";
import { UPLOAD_FILE_FIELD } from "../../shared/http/uploads.ts";

export interface UploadedFile {
  readonly bytes: ArrayBuffer;
  readonly contentType: string;
}

/** Copies only when the part is a view onto a larger buffer, so a 100 MB archive is not duplicated. */
const wholeBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const spansBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  // SAFETY: the multipart parser allocates plain ArrayBuffers, never a SharedArrayBuffer,
  // and this branch only runs when the view covers that whole buffer.
  return spansBuffer ? (bytes.buffer as ArrayBuffer) : bytes.slice().buffer;
};

const isUploadPart = (part: Multipart.Part): part is Multipart.File =>
  Multipart.isFile(part) && part.key === UPLOAD_FILE_FIELD;

/**
 * Reads the single uploaded file out of a multipart request. `contentEffect`
 * buffers the part, which the Worker already did when it read the whole body,
 * so this trades no memory against the raw-body handlers it replaced.
 */
export const uploadedFile = (
  payload: Stream.Stream<Multipart.Part, Multipart.MultipartError>,
): Effect.Effect<UploadedFile, BadRequest> =>
  payload.pipe(
    Stream.filter(isUploadPart),
    Stream.mapEffect((part) =>
      Effect.map(part.contentEffect, (bytes) => ({
        bytes: wholeBuffer(bytes),
        contentType: part.contentType,
      })),
    ),
    Stream.runHead,
    Effect.mapError(() => new BadRequest({ error: "invalid_request" })),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new BadRequest({ error: "invalid_request" })),
        onSome: Effect.succeed,
      }),
    ),
  );
