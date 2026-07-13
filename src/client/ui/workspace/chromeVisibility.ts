export type ChromeVisibilityLevel = 0 | 1 | 2;

export function stepChromeVisibility(
  level: ChromeVisibilityLevel,
  direction: "hide" | "show",
): ChromeVisibilityLevel {
  return Math.min(2, Math.max(0, level + (direction === "hide" ? 1 : -1))) as ChromeVisibilityLevel;
}
