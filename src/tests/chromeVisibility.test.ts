import { describe, expect, it } from "vitest";
import {
  stepChromeVisibility,
  type ChromeVisibilityLevel,
} from "../client/ui/workspace/chromeVisibility.ts";

describe("chrome visibility stepping", () => {
  const cases: Array<{
    current: ChromeVisibilityLevel;
    direction: "hide" | "show";
    expected: ChromeVisibilityLevel;
  }> = [
    { current: 0, direction: "hide", expected: 1 },
    { current: 1, direction: "hide", expected: 2 },
    { current: 2, direction: "show", expected: 1 },
    { current: 1, direction: "show", expected: 0 },
    { current: 2, direction: "hide", expected: 2 },
    { current: 0, direction: "show", expected: 0 },
  ];

  for (const { current, direction, expected } of cases) {
    it(`${direction} from level ${current} moves to level ${expected}`, () => {
      expect(stepChromeVisibility(current, direction)).toBe(expected);
    });
  }
});
