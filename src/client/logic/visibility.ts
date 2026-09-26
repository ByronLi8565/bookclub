export type ExpandedPane = "left" | "right" | null;

const EXPANDED_PANES: ExpandedPane[] = ["right", null, "left"];

export function stepExpandedPane(pane: ExpandedPane, direction: "left" | "right"): ExpandedPane {
  const index = EXPANDED_PANES.indexOf(pane);
  const next = Math.min(
    EXPANDED_PANES.length - 1,
    Math.max(0, index + (direction === "right" ? 1 : -1)),
  );
  return EXPANDED_PANES[next]!;
}
