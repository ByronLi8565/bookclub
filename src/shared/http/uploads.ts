import { Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

export const UPLOAD_FILE_FIELD = "file";

export const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_ARCHIVE_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_BOOK_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Uploads carry opaque bytes whose media type the caller chooses, which a byte
 * payload cannot express: the server dispatches payload decoding on an exact
 * content-type match and answers 415 on a miss, with no wildcard. As a multipart
 * part the media type travels in the part's own headers, the request's own
 * content-type is the single constant `multipart/form-data`, and the browser
 * streams the file from disk instead of the client buffering it into memory.
 */
export const FileUpload = (maxFileSize: number) =>
  Schema.Struct({ [UPLOAD_FILE_FIELD]: Schema.Unknown }).pipe(
    HttpApiSchema.asMultipartStream({ maxFileSize, maxTotalSize: maxFileSize }),
  );
