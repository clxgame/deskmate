import { describe, expect, test } from "bun:test";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import devConfig from "../../scripts/tauri.dev.conf.json";
import worklogQaConfig from "../../scripts/worklog-qa/tauri.qa.conf.json";
import historyQaConfig from "../../scripts/workbench-qa/unified-history.qa.conf.json";

/**
 * Native drops preserve the local paths needed to distinguish directories from
 * zero-byte browser Files and preview media without loading entire files into
 * JavaScript. Windows consumes external drops at this native boundary, so the
 * Rust handler must forward registered metadata through chat-resources-dropped.
 * DOM drops remain a fallback for clipboard/browser sources only.
 */
for (const [name, config] of [
  ["main", tauriConfig],
  ["development overlay", devConfig],
  ["worklog QA overlay", worklogQaConfig],
  ["unified history QA overlay", historyQaConfig],
] as const) {
  describe(`chat window drag & drop config: ${name}`, () => {
    const chatWindow = config.app.windows.find((window) => window.label === "chat");

    test("declares the chat window", () => {
      expect(chatWindow).toBeDefined();
    });

    test("enables the native handler needed for directory and streaming media references", () => {
      expect(chatWindow?.dragDropEnabled).toBe(true);
    });

    test("allows image and media previews through each platform's local resource protocol", () => {
      const csp = "security" in config.app ? config.app.security.csp : tauriConfig.app.security.csp;
      for (const directive of ["img-src", "media-src"] as const) {
        const sources = csp[directive].split(/\s+/);
        for (const source of ["chat-resource:", "http://chat-resource.localhost", "https://chat-resource.localhost"]) {
          expect(sources).toContain(source);
        }
      }
    });
  });
}
