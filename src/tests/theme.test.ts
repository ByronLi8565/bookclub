// @vitest-environment jsdom

import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme } from "../client/logic/theme.ts";
import { THEME_PRESETS, THEME_TOKEN_KEYS, ThemeTokens } from "../shared/types/theme.ts";

afterEach(() => {
  for (const key of THEME_TOKEN_KEYS) {
    document.documentElement.style.removeProperty(`--color-${key}`);
  }
});

describe("reader themes", () => {
  it("uses a charcoal dark surface with subdued borders and no visible shadow", () => {
    applyTheme({ themeId: "dark" });

    const root = document.documentElement.style;
    expect(root.getPropertyValue("--color-background")).toBe("#242424");
    expect(root.getPropertyValue("--color-border")).toBe("#4a4a4a");
    expect(root.getPropertyValue("--color-shadow")).toBe(THEME_PRESETS.dark.background);
  });

  it("decodes saved custom themes from before the shadow token existed", () => {
    const { shadow: _shadow, ...legacyTokens } = THEME_PRESETS.default;

    expect(Schema.decodeUnknownSync(ThemeTokens)(legacyTokens).shadow).toBe("#000000");
  });
});
