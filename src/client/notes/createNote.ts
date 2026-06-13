import * as Effect from "effect/Effect";
import type { Highlight } from "../highlights/types.ts";
import type { Note } from "./types.ts";

// Build a top-level Note from its embedded highlights and a body. The id is a
// local placeholder; the server will assign the canonical ulid in a later step.
export const createNote = (
  sourceId: string,
  body: string,
  highlights: Highlight[],
): Effect.Effect<Note> =>
  Effect.sync(() => ({
    id: crypto.randomUUID(),
    sourceId,
    author: "local",
    parent: null,
    body,
    highlights,
    createdAt: new Date().toISOString(),
    editedAt: null,
    version: 1,
  }));
