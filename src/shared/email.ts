// Canonical form for comparison/storage/lookup: trimmed and lowercased.
export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = canonicalEmail(raw);
  return /^[^@\s]+@[^@\s]+$/u.test(email) ? email : null;
}
