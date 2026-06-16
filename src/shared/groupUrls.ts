const FALLBACK_SLUG = "club";
const MAX_SLUG_LENGTH = 48;

export interface GroupUrlParts {
  slug: string;
  publicId: string;
}

export function slugForGroup(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replaceAll(/-$/gu, "");
  return slug || FALLBACK_SLUG;
}

export function groupUrlName(group: GroupUrlParts): string {
  return `${group.slug}-${group.publicId}`;
}

export function publicIdFromGroupUrl(value: string): string | null {
  const marker = value.lastIndexOf("-");
  if (marker < 0) return null;
  const publicId = value.slice(marker + 1);
  return publicId === "" ? null : publicId;
}
