export type ChromeVisibilityLevel = 0 | 1 | 2;
export type ExpandedPane = "left" | "right" | null;

const EXPANDED_PANES: ExpandedPane[] = ["right", null, "left"];

export function stepChromeVisibility(
  level: ChromeVisibilityLevel,
  direction: "hide" | "show",
): ChromeVisibilityLevel {
  return Math.min(2, Math.max(0, level + (direction === "hide" ? 1 : -1))) as ChromeVisibilityLevel;
}

export function stepExpandedPane(pane: ExpandedPane, direction: "left" | "right"): ExpandedPane {
  const index = EXPANDED_PANES.indexOf(pane);
  const next = Math.min(
    EXPANDED_PANES.length - 1,
    Math.max(0, index + (direction === "right" ? 1 : -1)),
  );
  return EXPANDED_PANES[next]!;
}
