import { describe, expect, test } from "bun:test";
import { DEFAULT_THEME_ID, THEME_IDS, normalizeThemeId } from "./theme";

describe("settings themes", () => {
  test("exposes the four supported palettes", () => {
    expect(THEME_IDS).toEqual(["dark", "mint", "peach", "lavender"]);
  });

  test("normalizes unknown persisted values to the dark default", () => {
    expect(normalizeThemeId("mint")).toBe("mint");
    expect(normalizeThemeId("peach")).toBe("peach");
    expect(normalizeThemeId("lavender")).toBe("lavender");
    expect(normalizeThemeId("unsupported")).toBe(DEFAULT_THEME_ID);
  });
});
