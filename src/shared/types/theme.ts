import * as Schema from "effect/Schema";

type SchemaType<S extends Schema.Top> = S["Type"];

export const ThemeId = Schema.Union([
  Schema.Literal("default"),
  Schema.Literal("dark"),
  Schema.Literal("sepia"),
  Schema.Literal("paper"),
  Schema.Literal("low-contrast"),
  Schema.Literal("custom"),
]);
export type ThemeId = typeof ThemeId.Type;

export const THEME_TOKEN_KEYS = [
  "background",
  "text",
  "muted",
  "border",
  "link",
  "highlight",
  "danger",
  "success",
  "warning",
] as const;
export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];

export const ThemeTokens = Schema.Struct({
  background: Schema.String,
  text: Schema.String,
  muted: Schema.String,
  border: Schema.String,
  link: Schema.String,
  highlight: Schema.String,
  danger: Schema.String,
  success: Schema.String,
  warning: Schema.String,
});
export interface ThemeTokens extends SchemaType<typeof ThemeTokens> {}

type BuiltinThemeId = Exclude<ThemeId, "custom">;

export const THEME_PRESETS = {
  default: {
    background: "#ffffff",
    text: "#000000",
    muted: "#777777",
    border: "#000000",
    link: "#0000ee",
    highlight: "#ffe600",
    danger: "#d60000",
    success: "#2ecc40",
    warning: "#c77800",
  },
  dark: {
    background: "#111111",
    text: "#f2f2f2",
    muted: "#9a9a9a",
    border: "#f2f2f2",
    link: "#8ab4ff",
    highlight: "#8a7300",
    danger: "#ff6b6b",
    success: "#4bd671",
    warning: "#e0a339",
  },
  sepia: {
    background: "#f4ecd8",
    text: "#3a3226",
    muted: "#8a7a5c",
    border: "#3a3226",
    link: "#5b4636",
    highlight: "#e8d27a",
    danger: "#9a3324",
    success: "#4c7a3f",
    warning: "#b4541b",
  },
  paper: {
    background: "#faf7f0",
    text: "#2b2b2b",
    muted: "#8a8880",
    border: "#2b2b2b",
    link: "#1c5fa8",
    highlight: "#f5e28a",
    danger: "#b3261e",
    success: "#356b3a",
    warning: "#a8681a",
  },
  "low-contrast": {
    background: "#e8e8e8",
    text: "#3d3d3d",
    muted: "#8f8f8f",
    border: "#8f8f8f",
    link: "#4361a8",
    highlight: "#d8cf9a",
    danger: "#a85a52",
    success: "#5c8a5f",
    warning: "#9c7c40",
  },
} satisfies Record<BuiltinThemeId, ThemeTokens>;

export const THEME_LABELS = {
  default: "Default",
  dark: "Dark",
  sepia: "Sepia",
  paper: "Paper",
  "low-contrast": "Low contrast",
  custom: "Custom",
} satisfies Record<ThemeId, string>;

export const DEFAULT_THEME_TOKENS: ThemeTokens = THEME_PRESETS.default;

export const Appearance = Schema.Struct({
  themeId: ThemeId,
  customColors: Schema.optionalKey(ThemeTokens),
});
export interface Appearance extends SchemaType<typeof Appearance> {}

export const DEFAULT_APPEARANCE: Appearance = { themeId: "default" };

/** What's actually painted: a preset's fixed map, or the reader's own colors
 *  once they've saved a custom config. */
export const resolveThemeTokens = (appearance: Appearance): ThemeTokens =>
  appearance.themeId === "custom"
    ? (appearance.customColors ?? DEFAULT_THEME_TOKENS)
    : THEME_PRESETS[appearance.themeId];

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u;

const isThemeTokenKey = (key: string): key is ThemeTokenKey =>
  THEME_TOKEN_KEYS.some((tokenKey) => tokenKey === key);

export const serializeThemeConfig = (tokens: ThemeTokens): string =>
  THEME_TOKEN_KEYS.map((key) => `${key}: ${tokens[key]}`).join("\n");

export interface ThemeConfigParseResult {
  readonly tokens: ThemeTokens;
  readonly errors: readonly string[];
}

/**
 * Reads a `key: #hexvalue` line per token. Unknown keys and bad values are
 * reported but don't block the rest of the config — a reader mid-edit sees
 * everything else they typed take effect, with the previous value held for
 * whatever line is still wrong.
 */
export const parseThemeConfig = (
  text: string,
  fallback: ThemeTokens = DEFAULT_THEME_TOKENS,
): ThemeConfigParseResult => {
  const overrides: Partial<Record<ThemeTokenKey, string>> = {};
  const errors: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      errors.push(`Ignored line, missing ":" — "${line}"`);
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!isThemeTokenKey(key)) {
      errors.push(`Unknown color name "${key}"`);
      continue;
    }
    if (!HEX_COLOR.test(value)) {
      errors.push(`"${key}" needs a hex color like #a1b2c3, got "${value}"`);
      continue;
    }
    overrides[key] = value;
  }
  return { tokens: { ...fallback, ...overrides }, errors };
};
