/** Reader exceptions often contain the only clue to a failing file or browser asset. */
export function inspectionErrorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return detail.trim().slice(0, 300);
}
