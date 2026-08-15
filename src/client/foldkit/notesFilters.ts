import { Schema } from "effect";
import type { Note } from "../../shared/types/notes.ts";
import type {
  NoteFilterTerm as MutableNoteFilterTerm,
  NoteQuery,
  NoteQueryContext,
  NotesScope,
} from "../logic/notes/noteQuery.ts";

/**
 * The filter terms React's `NoteFilterBar` builds, as a Schema, so the panel can
 * keep them in the Model. `noteQuery.ts` owns what a term *means*; this file
 * only says what one is allowed to be on the wire.
 */
const TagTerm = Schema.Struct({
  kind: Schema.tag("tag"),
  value: Schema.String,
  negated: Schema.Boolean,
});

const BookTerm = Schema.Struct({
  kind: Schema.tag("property"),
  property: Schema.tag("book"),
  value: Schema.String,
  negated: Schema.Boolean,
});

const AuthorTerm = Schema.Struct({
  kind: Schema.tag("property"),
  property: Schema.tag("author"),
  value: Schema.String,
  negated: Schema.Boolean,
});

const TypeTerm = Schema.Struct({
  kind: Schema.tag("property"),
  property: Schema.tag("type"),
  value: Schema.Literals(["note", "reply"]),
  negated: Schema.Boolean,
});

export const NoteFilterTerm = Schema.Union([TagTerm, BookTerm, AuthorTerm, TypeTerm]);
export type NoteFilterTerm = typeof NoteFilterTerm.Type;

export const NotesScopeKind = Schema.Literals(["current-book", "all-books"]);
export type NotesScopeKind = typeof NotesScopeKind.Type;

export const NoteFilterMode = Schema.Literals(["all", "any"]);
export type NoteFilterMode = typeof NoteFilterMode.Type;

/** The Model holds readonly terms; `noteQuery.ts` asks for mutable ones. */
export const noteQueryOf = (terms: readonly NoteFilterTerm[], mode: NoteFilterMode): NoteQuery => ({
  terms: terms.map((term): MutableNoteFilterTerm => ({ ...term })),
  mode,
});

export const notesScopeOf = (kind: NotesScopeKind, sourceId: string): NotesScope =>
  kind === "all-books" ? { kind: "all-books" } : { kind: "current-book", sourceId };

/**
 * Filter labels need names for the ids notes carry. Authors are in the notes
 * themselves; only book titles have to come from the host.
 */
export const noteQueryContextOf = (
  notes: readonly Note[],
  bookTitles: ReadonlyMap<string, string>,
): NoteQueryContext => ({
  sources: bookTitles,
  authors: new Map(notes.map((note) => [note.author.id, note.author.name] as const)),
});
