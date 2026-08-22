import { THEME_TOKEN_KEYS, resolveThemeTokens, type Appearance } from "../../shared/types/theme.ts";

/**
 * Written onto `:root` so every stylesheet's `--color-*` custom property picks
 * it up immediately — no class toggling or stylesheet swap needed. Called
 * before the Foldkit runtime mounts (from cached prefs) so there's no flash of
 * the default theme, and again whenever appearance prefs change.
 */
export function applyTheme(appearance: Appearance): void {
  const tokens = resolveThemeTokens(appearance);
  const root = document.documentElement.style;
  for (const key of THEME_TOKEN_KEYS) {
    root.setProperty(`--color-${key}`, tokens[key]);
  }
}
