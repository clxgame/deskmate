export const THEME_IDS = ["dark", "mint", "peach", "lavender"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = "dark";

export function normalizeThemeId(value: string): ThemeId {
  return THEME_IDS.find((id) => id === value) ?? DEFAULT_THEME_ID;
}
