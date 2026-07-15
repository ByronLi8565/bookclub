import type { Note } from "../../../shared/types/notes.ts";
import { isHiddenTag, normalizeTag } from "../../../shared/notes/tags.ts";
import { buildConversation, type Conversation } from "./conversation.ts";

export type NoteProperty = "book" | "author" | "type";

export type NoteFilterTerm =
  | { kind: "tag"; value: string; negated: boolean }
  | { kind: "property"; property: "book"; value: string; negated: boolean }
  | { kind: "property"; property: "author"; value: string; negated: boolean }
  | { kind: "property"; property: "type"; value: "note" | "reply"; negated: boolean };

export interface NoteQuery {
  terms: NoteFilterTerm[];
  mode: "all" | "any";
}

export type NotesScope = { kind: "current-book"; sourceId: string } | { kind: "all-books" };

export interface NoteQueryContext {
  sources: ReadonlyMap<string, string>;
  authors: ReadonlyMap<string, string>;
}

export interface FilteredConversation {
  conversation: Conversation;
  matchingIds: ReadonlySet<string>;
  contextIds: ReadonlySet<string>;
  resultCount: number;
}

export interface NoteFilterSuggestion {
  term: NoteFilterTerm;
  label: string;
  group: "Tags" | "Books" | "Authors" | "Type";
  count: number;
}

export const EMPTY_NOTE_QUERY: NoteQuery = { terms: [], mode: "all" };

function matchesPositiveTerm(note: Note, term: NoteFilterTerm): boolean {
  if (term.kind === "tag") {
    const tag = normalizeTag(term.value);
    return tag !== null && (note.tags?.includes(tag) ?? false);
  }
  switch (term.property) {
    case "book":
      return note.sourceId === term.value;
    case "author":
      return note.author.id === term.value;
    case "type":
      return term.value === (note.parent === null ? "note" : "reply");
  }
}

export function matchesNoteQuery(note: Note, query: NoteQuery): boolean {
  const included = query.terms.filter((term) => !term.negated);
  const excluded = query.terms.filter((term) => term.negated);
  if (excluded.some((term) => matchesPositiveTerm(note, term))) return false;
  if (included.length === 0) return true;
  return query.mode === "all"
    ? included.every((term) => matchesPositiveTerm(note, term))
    : included.some((term) => matchesPositiveTerm(note, term));
}

export function filterConversation(
  notes: readonly Note[],
  scope: NotesScope,
  query: NoteQuery,
): FilteredConversation {
  const scoped =
    scope.kind === "all-books"
      ? [...notes]
      : notes.filter((note) => note.sourceId === scope.sourceId);
  const full = buildConversation(scoped);
  if (query.terms.length === 0) {
    const matchingIds = new Set(scoped.map((note) => note.id));
    return {
      conversation: full,
      matchingIds,
      contextIds: new Set(),
      resultCount: matchingIds.size,
    };
  }

  const matchingIds = new Set(
    scoped
      .filter((note) => note.deletedAt === null && matchesNoteQuery(note, query))
      .map((note) => note.id),
  );
  const includedIds = new Set(matchingIds);

  const includeDescendants = (id: string): void => {
    for (const child of full.childrenOf(id)) {
      includedIds.add(child.id);
      includeDescendants(child.id);
    }
  };
  for (const id of matchingIds) {
    includeDescendants(id);
    let current = full.byId.get(id);
    const seen = new Set<string>();
    while (current?.parent && !seen.has(current.id)) {
      seen.add(current.id);
      includedIds.add(current.parent);
      current = full.byId.get(current.parent);
    }
  }

  const visible = scoped.filter((note) => includedIds.has(note.id));
  const contextIds = new Set(
    visible.filter((note) => !matchingIds.has(note.id)).map((note) => note.id),
  );
  return {
    conversation: buildConversation(visible),
    matchingIds,
    contextIds,
    resultCount: matchingIds.size,
  };
}

export function noteFilterSuggestions(
  notes: readonly Note[],
  context: NoteQueryContext,
): NoteFilterSuggestion[] {
  const tags = new Map<string, number>();
  const books = new Map<string, number>();
  const authors = new Map<string, number>();
  let roots = 0;
  let replies = 0;
  for (const note of notes) {
    if (note.deletedAt !== null) continue;
    for (const tag of note.tags ?? []) {
      if (!isHiddenTag(tag)) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    books.set(note.sourceId, (books.get(note.sourceId) ?? 0) + 1);
    authors.set(note.author.id, (authors.get(note.author.id) ?? 0) + 1);
    if (note.parent === null) roots += 1;
    else replies += 1;
  }

  const suggestions: NoteFilterSuggestion[] = [
    ...[...tags].map(([value, count]) => ({
      term: { kind: "tag", value, negated: false } as const,
      label: value,
      group: "Tags" as const,
      count,
    })),
    ...[...books].map(([value, count]) => ({
      term: { kind: "property", property: "book", value, negated: false } as const,
      label: context.sources.get(value) ?? "Untitled book",
      group: "Books" as const,
      count,
    })),
    ...[...authors].map(([value, count]) => ({
      term: { kind: "property", property: "author", value, negated: false } as const,
      label: context.authors.get(value) ?? "Unknown author",
      group: "Authors" as const,
      count,
    })),
    {
      term: { kind: "property", property: "type", value: "note", negated: false },
      label: "Note",
      group: "Type",
      count: roots,
    },
    {
      term: { kind: "property", property: "type", value: "reply", negated: false },
      label: "Reply",
      group: "Type",
      count: replies,
    },
  ];
  return suggestions.toSorted(
    (a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label),
  );
}

export function filterTermKey(term: NoteFilterTerm): string {
  return term.kind === "tag" ? `tag:${term.value}` : `${term.property}:${term.value}`;
}

export function filterTermLabel(term: NoteFilterTerm, context: NoteQueryContext): string {
  if (term.kind === "tag") return term.value;
  switch (term.property) {
    case "book":
      return `Book: ${context.sources.get(term.value) ?? "Untitled book"}`;
    case "author":
      return `Author: ${context.authors.get(term.value) ?? "Unknown author"}`;
    case "type":
      return `Type: ${term.value === "note" ? "Note" : "Reply"}`;
  }
}
