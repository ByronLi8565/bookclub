import { describe, expect, it } from "vitest";
import {
  extractReferences,
  REFERENCE_IMPORT,
  REFERENCE_PATTERN,
  REFERENCE_TYPING,
} from "./references.ts";

describe("extractReferences", () => {
  it("returns every referenced seq in order, keeping duplicates", () => {
    expect(extractReferences("see [[3]] and [[1]] and again [[3]]")).toEqual([3, 1, 3]);
  });

  it("returns nothing when there are no references", () => {
    expect(extractReferences("plain text")).toEqual([]);
  });
});

describe("reference pattern variants share one grammar", () => {
  it("REFERENCE_PATTERN is global so it can scan a whole body", () => {
    expect(REFERENCE_PATTERN.global).toBe(true);
  });

  it("REFERENCE_IMPORT matches a reference anywhere in the text", () => {
    expect("a [[7]] b".match(REFERENCE_IMPORT)?.[1]).toBe("7");
  });

  it("REFERENCE_TYPING only matches a reference at the end of the input", () => {
    expect(REFERENCE_TYPING.test("typing [[7]]")).toBe(true);
    expect(REFERENCE_TYPING.test("[[7]] then more")).toBe(false);
  });
});
