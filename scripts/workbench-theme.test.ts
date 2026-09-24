import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildWorkbenchThemeCss, injectWorkbenchThemeAssets } from "./workbench-theme";

const palette = readFileSync(resolve(import.meta.dir, "../src/theme.css"), "utf8");

describe("workbench theme assets", () => {
  test("all four workbench palettes inherit YUME's actual CSS values", () => {
    const css = buildWorkbenchThemeCss(palette);
    for (const [id, surface, accent] of [
      ["dark", "#181922", "#7d9ef8"],
      ["mint", "#f9f6ec", "#6ebc99"],
      ["peach", "#fff8f0", "#ed9b7e"],
      ["lavender", "#faf7fc", "#ab95e3"],
    ]) {
      expect(css).toContain(`html[data-yume-theme="${id}"]`);
      expect(css).toContain(`--surface: ${surface}`);
      expect(css).toContain(`--accent: ${accent}`);
    }
    expect(css).toContain("--v2-background-bg-deep: var(--surface)");
    expect(css).toContain("--v2-text-text-base: var(--text)");
    expect(css).toContain("--v2-border-border-focus: var(--accent)");
  });

  test("missing palette fails the build rather than silently shipping a partial theme", () => {
    expect(() => buildWorkbenchThemeCss(palette.replace('data-theme="lavender"', 'data-theme="other"'))).toThrow();
  });

  test("injects one early bridge and stylesheet without duplicate tags", () => {
    const html = "<html><head><title>OpenCode</title></head><body></body></html>";
    const result = injectWorkbenchThemeAssets(html);
    expect(result).toContain('<script src="./yume-theme-bridge.js"></script>');
    expect(result).toContain('<link rel="stylesheet" href="./yume-theme.css" />');
    expect(result).toBe(injectWorkbenchThemeAssets(result));
  });
});
