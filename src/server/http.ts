// Small request helpers shared by the worker's route modules.

// Normalize an email for use as both the AuthAgent key and the stored address.
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  // Deliberately permissive: a single `@` with non-empty sides. Real validation
  // happens by whether the code is received.
  return /^[^@\s]+@[^@\s]+$/u.test(email) ? email : null;
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
