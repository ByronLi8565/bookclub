import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  BookclubArchiveError,
  createBookclubArchive,
  decodeBookclubArchive,
  type CreateBookclubArchiveInput,
} from "../shared/backups/bookclubArchive.ts";

const IMAGE_ID = "01JH0000000000000000000000";

function source(): CreateBookclubArchiveInput {
  return {
    createdAt: "2026-07-12T12:00:00.000Z",
    club: { id: "club-id", name: "Readers", publicId: "reader" },
    nextSeq: 3,
    books: [
      {
        sourceId: "book-id",
        title: "Book",
        meta: {
          kind: "epub",
          contentType: "application/epub+zip",
          size: 100,
          addedBy: "author-id",
        },
      },
    ],
    notes: [
      {
        id: "note-one",
        seq: 1,
        sourceId: "book-id",
        author: { id: "author-id", name: "Reader" },
        parent: null,
        body: `Hello\n\n[[image:${IMAGE_ID}]]`,
        highlights: [],
        createdAt: "2026-07-01T12:00:00.000Z",
        editedAt: null,
        deletedAt: null,
        version: 1,
      },
      {
        id: "note-two",
        seq: 2,
        sourceId: "book-id",
        author: { id: "author-id", name: "Reader" },
        parent: "note-one",
        body: "A reply",
        highlights: [],
        createdAt: "2026-07-01T13:00:00.000Z",
        editedAt: null,
        deletedAt: null,
        version: 1,
      },
    ],
    images: [
      {
        id: IMAGE_ID,
        contentType: "image/webp",
        uploadedBy: "author-id",
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
  };
}

describe(".bookclub archives", () => {
  it("round-trips Markdown bodies, note metadata, and images", async () => {
    const archive = await createBookclubArchive(source());
    const decoded = await decodeBookclubArchive(archive);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.manifest.format).toBe("bookclub-backup");
    expect(decoded.value.notes).toEqual(source().notes);
    expect(decoded.value.images[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(Object.keys(unzipSync(archive)).toSorted()).toEqual([
      `images/${IMAGE_ID}.webp`,
      "manifest.json",
      "notes/000001-note-one.md",
      "notes/000002-note-two.md",
    ]);
  });

  it("rejects an unsupported format version", async () => {
    const archive = await createBookclubArchive(source());
    const files = unzipSync(archive);
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    manifest.version = 2;
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    const decoded = await decodeBookclubArchive(zipSync(files));
    expect(decoded).toEqual({ ok: false, error: BookclubArchiveError.UnsupportedVersion });
  });

  it("rejects archives with missing referenced images", async () => {
    const archive = await createBookclubArchive(source());
    const files = unzipSync(archive);
    delete files[`images/${IMAGE_ID}.webp`];
    const decoded = await decodeBookclubArchive(zipSync(files));
    expect(decoded).toEqual({ ok: false, error: BookclubArchiveError.MissingEntry });
  });

  it("rejects unsafe ZIP paths", async () => {
    const decoded = await decodeBookclubArchive(zipSync({ "../manifest.json": strToU8("{}") }));
    expect(decoded).toEqual({ ok: false, error: BookclubArchiveError.InvalidArchive });
  });
});
