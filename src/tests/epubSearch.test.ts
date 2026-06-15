// @vitest-environment jsdom
//
// Integration test for the epub full-text search pipeline against a real book
// (assets/dorian.epub, public domain). epub.js runs under jsdom here; this
// exercises the exact path used by the reader's ctrl+f — loading every spine
// section, scanning its text, and mapping matches back to EPUB CFIs.
//
// This guards the bug where the per-section handle was fed `section.load()`'s
// return value (the <html> element, whose `.body` is undefined) instead of
// `section.document`, which silently yielded zero matches for every query.
import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import ePub, { type Book } from "epubjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeEpubReader } from "../client/ui/reader/epubReader.ts";

let book: Book;

beforeAll(async () => {
  const bytes = new Uint8Array(readFileSync("assets/dorian.epub"));
  book = ePub();
  // A jsdom-realm ArrayBuffer; JSZip rejects node's Buffer ArrayBuffer.
  await book.open(bytes.buffer, "binary");
  await book.ready;
});

afterAll(() => book?.destroy());

const search = (query: string) => Effect.runPromise(makeEpubReader(() => book).search(query));

describe("epub search", () => {
  it("finds a common word across the book and resolves each hit to a cfi", async () => {
    const matches = await search("room");
    expect(matches.length).toBeGreaterThan(10);
    for (const match of matches) {
      expect(match.anchor.kind).toBe("epub-cfi");
      if (match.anchor.kind === "epub-cfi") {
        expect(match.anchor.value).toMatch(/^epubcfi\(/u);
      }
      expect(match.excerpt.toLowerCase()).toContain("room");
    }
  });

  it("scans the whole book: 'forehead' occurs exactly 12 times", async () => {
    const matches = await search("forehead");
    expect(matches.length).toBe(12);
  });

  it("matches case-insensitively", async () => {
    const lower = await search("dorian");
    const upper = await search("DORIAN");
    expect(lower.length).toBeGreaterThan(0);
    expect(upper.length).toBe(lower.length);
  });

  it("finds a distinctive character name", async () => {
    const matches = await search("Basil");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("returns no matches for an absent string", async () => {
    expect(await search("xqzwvk")).toEqual([]);
  });

  it("returns no matches for an empty or whitespace query", async () => {
    expect(await search("")).toEqual([]);
    expect(await search("   ")).toEqual([]);
  });

  it("produces cfis that epub.js can resolve back to a range", async () => {
    const [match] = await search("portrait");
    expect(match).toBeDefined();
    if (match?.anchor.kind === "epub-cfi") {
      const range = await book.getRange(match.anchor.value);
      expect(range?.toString().toLowerCase()).toContain("portrait");
    }
  });
});
