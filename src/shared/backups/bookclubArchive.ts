import * as Schema from "effect/Schema";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { decode } from "../schema.ts";
import { noteImageIds } from "../notes/images.ts";
import type { Note } from "../types/notes.ts";
import type { SourceMeta } from "../types/groups.ts";

export const BOOKCLUB_ARCHIVE_CONTENT_TYPE = "application/vnd.bookclub.backup+zip";
export const BOOKCLUB_ARCHIVE_EXTENSION = ".bookclub";
export const MAX_BOOKCLUB_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_EXPANDED_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const BookclubArchiveError = {
  InvalidArchive: "invalid_archive",
  UnsupportedVersion: "unsupported_version",
  TooLarge: "too_large",
  MissingEntry: "missing_entry",
  IntegrityMismatch: "integrity_mismatch",
} as const;

export type BookclubArchiveError = (typeof BookclubArchiveError)[keyof typeof BookclubArchiveError];

export interface BookclubArchiveClub {
  id: string;
  name: string;
  publicId: string;
}

export interface BookclubArchiveBook {
  sourceId: string;
  title: string | null;
  meta: SourceMeta;
}

export interface BookclubArchiveImage {
  id: string;
  contentType: string;
  uploadedBy: string | null;
  bytes: Uint8Array;
}

interface ManifestNote extends Omit<Note, "body"> {
  file: string;
}

interface ManifestImage {
  id: string;
  file: string;
  contentType: string;
  size: number;
  sha256: string;
  uploadedBy: string | null;
}

export interface BookclubArchiveManifest {
  format: "bookclub-backup";
  version: 1;
  createdAt: string;
  club: BookclubArchiveClub;
  nextSeq: number;
  books: BookclubArchiveBook[];
  notes: ManifestNote[];
  images: ManifestImage[];
}

export interface BookclubArchiveData {
  manifest: BookclubArchiveManifest;
  notes: Note[];
  images: BookclubArchiveImage[];
}

export interface CreateBookclubArchiveInput {
  createdAt: string;
  club: BookclubArchiveClub;
  nextSeq: number;
  books: BookclubArchiveBook[];
  notes: Note[];
  images: BookclubArchiveImage[];
}

export type DecodeBookclubArchiveResult =
  | { ok: true; value: BookclubArchiveData }
  | { ok: false; error: BookclubArchiveError };

const PdfRectSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
const HighlightAnchorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("epub-cfi"), value: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("pdf-text"),
    page: Schema.Number,
    rects: Schema.mutable(Schema.Array(PdfRectSchema)),
  }),
]);
const HighlightSchema = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  anchor: HighlightAnchorSchema,
  quote: Schema.Struct({
    type: Schema.Literal("TextQuoteSelector"),
    exact: Schema.String,
    prefix: Schema.String,
    suffix: Schema.String,
  }),
  createdAt: Schema.String,
});
const NoteSchema = Schema.Struct({
  id: Schema.String,
  seq: Schema.Number,
  sourceId: Schema.String,
  author: Schema.Struct({ id: Schema.String, name: Schema.String }),
  parent: Schema.NullOr(Schema.String),
  file: Schema.String,
  highlights: Schema.mutable(Schema.Array(HighlightSchema)),
  createdAt: Schema.String,
  editedAt: Schema.NullOr(Schema.String),
  deletedAt: Schema.NullOr(Schema.String),
  version: Schema.Number,
  tags: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
});
const SourceMetaSchema = Schema.Struct({
  kind: Schema.Union([Schema.Literal("epub"), Schema.Literal("pdf")]),
  contentType: Schema.String,
  size: Schema.Number,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  author: Schema.optionalKey(Schema.NullOr(Schema.String)),
  wordCount: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  addedBy: Schema.String,
});
const ManifestSchema = Schema.Struct({
  format: Schema.Literal("bookclub-backup"),
  version: Schema.Literal(1),
  createdAt: Schema.String,
  club: Schema.Struct({ id: Schema.String, name: Schema.String, publicId: Schema.String }),
  nextSeq: Schema.Number,
  books: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        sourceId: Schema.String,
        title: Schema.NullOr(Schema.String),
        meta: SourceMetaSchema,
      }),
    ),
  ),
  notes: Schema.mutable(Schema.Array(NoteSchema)),
  images: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        file: Schema.String,
        contentType: Schema.String,
        size: Schema.Number,
        sha256: Schema.String,
        uploadedBy: Schema.NullOr(Schema.String),
      }),
    ),
  ),
});

function imageExtension(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/gif") return "gif";
  return "webp";
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function notePath(note: Note): string {
  return `notes/${String(note.seq).padStart(6, "0")}-${note.id}.md`;
}

function safeArchivePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export async function createBookclubArchive(
  input: CreateBookclubArchiveInput,
): Promise<Uint8Array> {
  const entries: Zippable = {};
  const notes = input.notes
    .toSorted((a, b) => a.seq - b.seq)
    .map((note) => {
      const file = notePath(note);
      const { body, ...metadata } = note;
      entries[file] = strToU8(body);
      return { ...metadata, file };
    });
  const images: ManifestImage[] = [];
  for (const image of input.images.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const file = `images/${image.id}.${imageExtension(image.contentType)}`;
    entries[file] = [image.bytes, { level: 0 }];
    images.push({
      id: image.id,
      file,
      contentType: image.contentType,
      size: image.bytes.byteLength,
      sha256: await sha256(image.bytes),
      uploadedBy: image.uploadedBy,
    });
  }
  const manifest: BookclubArchiveManifest = {
    format: "bookclub-backup",
    version: 1,
    createdAt: input.createdAt,
    club: input.club,
    nextSeq: input.nextSeq,
    books: input.books,
    notes,
    images,
  };
  entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(entries, { level: 6 });
}

function invalid(error: BookclubArchiveError): DecodeBookclubArchiveResult {
  return { ok: false, error };
}

export async function decodeBookclubArchive(
  bytes: Uint8Array,
): Promise<DecodeBookclubArchiveResult> {
  if (bytes.byteLength > MAX_BOOKCLUB_ARCHIVE_BYTES) return invalid(BookclubArchiveError.TooLarge);

  let limitError: BookclubArchiveError | null = null;
  let entryCount = 0;
  let expandedSize = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (entry) => {
        entryCount += 1;
        expandedSize += entry.originalSize;
        if (entryCount > MAX_ARCHIVE_ENTRIES || expandedSize > MAX_EXPANDED_ARCHIVE_BYTES) {
          limitError = BookclubArchiveError.TooLarge;
          throw new Error(BookclubArchiveError.TooLarge);
        }
        if (!safeArchivePath(entry.name)) {
          limitError = BookclubArchiveError.InvalidArchive;
          throw new Error(BookclubArchiveError.InvalidArchive);
        }
        return true;
      },
    });
  } catch {
    return invalid(limitError ?? BookclubArchiveError.InvalidArchive);
  }

  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) return invalid(BookclubArchiveError.MissingEntry);
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch {
    return invalid(BookclubArchiveError.InvalidArchive);
  }
  if (
    rawManifest &&
    typeof rawManifest === "object" &&
    "format" in rawManifest &&
    rawManifest.format === "bookclub-backup" &&
    "version" in rawManifest &&
    rawManifest.version !== 1
  ) {
    return invalid(BookclubArchiveError.UnsupportedVersion);
  }
  const decoded = decode(ManifestSchema, rawManifest);
  if (!decoded) return invalid(BookclubArchiveError.InvalidArchive);
  const manifest = decoded as BookclubArchiveManifest;
  const manifestSourceIds = manifest.books.map((book) => book.sourceId);
  if (
    !manifest.club.id ||
    !manifest.club.name ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    new Set(manifestSourceIds).size !== manifestSourceIds.length ||
    manifest.books.some(
      (book) =>
        !book.sourceId ||
        !Number.isSafeInteger(book.meta.size) ||
        book.meta.size < 0 ||
        (book.meta.wordCount !== undefined &&
          book.meta.wordCount !== null &&
          (!Number.isSafeInteger(book.meta.wordCount) || book.meta.wordCount < 0)),
    )
  ) {
    return invalid(BookclubArchiveError.InvalidArchive);
  }

  const noteIds = new Set<string>();
  const sequences = new Set<number>();
  const files = new Set(["manifest.json"]);
  const sourceIds = new Set(manifestSourceIds);
  const notes: Note[] = [];
  for (const metadata of manifest.notes) {
    if (
      !safeArchivePath(metadata.file) ||
      metadata.file !== notePath({ ...metadata, body: "" }) ||
      files.has(metadata.file) ||
      noteIds.has(metadata.id) ||
      sequences.has(metadata.seq) ||
      !Number.isSafeInteger(metadata.seq) ||
      metadata.seq < 1 ||
      !Number.isSafeInteger(metadata.version) ||
      metadata.version < 1 ||
      !sourceIds.has(metadata.sourceId)
    ) {
      return invalid(BookclubArchiveError.InvalidArchive);
    }
    const bodyBytes = entries[metadata.file];
    if (!bodyBytes) return invalid(BookclubArchiveError.MissingEntry);
    let body: string;
    try {
      body = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
    } catch {
      return invalid(BookclubArchiveError.InvalidArchive);
    }
    const { file: _, ...noteMetadata } = metadata;
    notes.push({ ...noteMetadata, body });
    noteIds.add(metadata.id);
    sequences.add(metadata.seq);
    files.add(metadata.file);
  }
  if (
    notes.some((note) => note.parent !== null && !noteIds.has(note.parent)) ||
    !Number.isSafeInteger(manifest.nextSeq) ||
    manifest.nextSeq <= Math.max(0, ...sequences)
  ) {
    return invalid(BookclubArchiveError.InvalidArchive);
  }

  const referencedImages = new Set(notes.flatMap((note) => [...noteImageIds(note.body)]));
  const imageIds = new Set<string>();
  const images: BookclubArchiveImage[] = [];
  for (const metadata of manifest.images) {
    if (
      !safeArchivePath(metadata.file) ||
      metadata.file !== `images/${metadata.id}.${imageExtension(metadata.contentType)}` ||
      files.has(metadata.file) ||
      imageIds.has(metadata.id) ||
      !IMAGE_CONTENT_TYPES.has(metadata.contentType) ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 0 ||
      !/^[a-f0-9]{64}$/u.test(metadata.sha256)
    ) {
      return invalid(BookclubArchiveError.InvalidArchive);
    }
    const imageBytes = entries[metadata.file];
    if (!imageBytes) return invalid(BookclubArchiveError.MissingEntry);
    if (imageBytes.byteLength !== metadata.size || (await sha256(imageBytes)) !== metadata.sha256) {
      return invalid(BookclubArchiveError.IntegrityMismatch);
    }
    images.push({
      id: metadata.id,
      contentType: metadata.contentType,
      uploadedBy: metadata.uploadedBy,
      bytes: imageBytes,
    });
    imageIds.add(metadata.id);
    files.add(metadata.file);
  }
  if (
    referencedImages.size !== imageIds.size ||
    [...referencedImages].some((id) => !imageIds.has(id)) ||
    Object.keys(entries).some((file) => !files.has(file))
  ) {
    return invalid(BookclubArchiveError.InvalidArchive);
  }

  return { ok: true, value: { manifest, notes, images } };
}
