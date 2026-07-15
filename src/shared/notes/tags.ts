export const MAX_NOTE_TAGS = 30;
export const MAX_NOTE_TAG_LENGTH = 100;

export interface SemanticTagDefinition {
  reserved: boolean;
  hidden?: boolean;
}

// Semantic tags share the user-facing namespace so they remain composable with
// ordinary tags. Reserved tags are changed by their owning workflow rather than
// by the generic tag editor.
export const SEMANTIC_TAGS: Record<string, SemanticTagDefinition> = {
  highlight: { reserved: true, hidden: true },
};

export function normalizeTag(input: string): string | null {
  const normalized = input
    .normalize("NFKC")
    .trim()
    .replace(/^#+/u, "")
    .toLocaleLowerCase("en-US")
    .replaceAll(/\s+/gu, "-")
    .replaceAll(/[^\p{Letter}\p{Number}_/-]+/gu, "-")
    .replaceAll(/-{2,}/gu, "-")
    .replaceAll(/-*\/-*/gu, "/")
    .replaceAll(/\/{2,}/gu, "/")
    .replaceAll(/^[-/]+|[-/]+$/gu, "");
  if (!normalized || normalized.length > MAX_NOTE_TAG_LENGTH) return null;
  if (normalized.split("/").some((segment) => segment.length === 0)) return null;
  return normalized;
}

export function normalizeTags(inputs: readonly string[]): string[] {
  const tags = new Set<string>();
  for (const input of inputs) {
    const tag = normalizeTag(input);
    if (tag) tags.add(tag);
    if (tags.size === MAX_NOTE_TAGS) break;
  }
  return [...tags].toSorted();
}

export function isReservedTag(tag: string): boolean {
  const definition: SemanticTagDefinition | undefined = SEMANTIC_TAGS[tag];
  return definition?.reserved ?? false;
}

export function isHiddenTag(tag: string): boolean {
  const definition: SemanticTagDefinition | undefined = SEMANTIC_TAGS[tag];
  return definition?.hidden ?? false;
}

export function editableTags(tags: readonly string[] | undefined): string[] {
  return normalizeTags(tags ?? []).filter((tag) => !isReservedTag(tag));
}

const INLINE_TAG_PATTERN = /(^|[\s([{])##([\p{Letter}\p{Number}_][\p{Letter}\p{Number}_/-]*)/gu;
const COMPLETED_INLINE_TAG_PATTERN =
  /(^|[\s([{])##([\p{Letter}\p{Number}_][\p{Letter}\p{Number}_/-]*)(?=[\s.,!?;:)])/gu;

export function noteTagsInBody(body: string): string[] {
  return normalizeTags([...body.matchAll(INLINE_TAG_PATTERN)].map((match) => match[2] ?? ""));
}

function withoutHashtags(body: string, pattern: RegExp): string {
  return body
    .replaceAll(pattern, (_match, prefix: string) => prefix)
    .replaceAll(/[ \t]{2,}/gu, " ")
    .replaceAll(/[ \t]+([.,!?;:)])/gu, "$1")
    .replaceAll(/[ \t]+$/gmu, "")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
}

export function processNoteHashtags(body: string): { body: string; tags: string[] } {
  const tags = noteTagsInBody(body);
  return tags.length === 0
    ? { body, tags }
    : { body: withoutHashtags(body, INLINE_TAG_PATTERN), tags };
}

export function processCompletedNoteHashtags(body: string): { body: string; tags: string[] } {
  const tags = normalizeTags(
    [...body.matchAll(COMPLETED_INLINE_TAG_PATTERN)].map((match) => match[2] ?? ""),
  );
  return tags.length === 0
    ? { body, tags }
    : {
        body: body
          .replaceAll(COMPLETED_INLINE_TAG_PATTERN, (_match, prefix: string) => prefix)
          .replaceAll(/[ \t]{2,}/gu, " ")
          .replaceAll(/[ \t]+([.,!?;:)])/gu, "$1"),
        tags,
      };
}

export function completedNoteHashtagCursor(body: string): number | null {
  const matches = [...body.matchAll(COMPLETED_INLINE_TAG_PATTERN)];
  const match = matches.at(-1);
  if (!match || match.index === undefined) return null;
  const beforeTag = body.slice(0, match.index + (match[1]?.length ?? 0));
  return processCompletedNoteHashtags(beforeTag).body.length;
}
