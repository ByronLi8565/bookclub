import { describe, expect, it } from "vitest";
import { stepExpandedPane, type ExpandedPane } from "../client/ui/shared/SplitPane.tsx";

describe("desktop pane view stepping", () => {
  const cases: Array<{
    current: ExpandedPane;
    direction: "left" | "right";
    expected: ExpandedPane;
  }> = [
    { current: null, direction: "left", expected: "right" },
    { current: "right", direction: "right", expected: null },
    { current: null, direction: "right", expected: "left" },
    { current: "left", direction: "left", expected: null },
    { current: "right", direction: "left", expected: "right" },
    { current: "left", direction: "right", expected: "left" },
  ];

  for (const { current, direction, expected } of cases) {
    it(`${direction} from ${current ?? "split"} moves to ${expected ?? "split"}`, () => {
      expect(stepExpandedPane(current, direction)).toBe(expected);
    });
  }
});
