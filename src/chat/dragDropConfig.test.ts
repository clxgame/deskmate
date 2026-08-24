import { describe, expect, test } from "bun:test";
import tauriConfig from "../../src-tauri/tauri.conf.json";

/**
 * Regression guard for the real-runtime drag & drop failure.
 *
 * Tauri's `dragDropEnabled` defaults to true. When it is true on Windows, wry
 * installs a native IDropTarget and calls `SetAllowExternalDrop(false)` on the
 * WebView2 controller, so the OS file drop is consumed by the native layer and
 * the DOM never receives `dragenter` / `dragover` / `drop` for real files.
 *
 * The chat composer implements attachment drops in the WebView with HTML5
 * drag & drop, so the chat window must opt out of the native handler.
 * A mock browser cannot catch this regression, only the real app can.
 */
describe("chat window drag & drop config", () => {
  const chatWindow = tauriConfig.app.windows.find(
    (window) => window.label === "chat",
  );

  test("declares the chat window", () => {
    expect(chatWindow).toBeDefined();
  });

  test("disables the native drag & drop handler so HTML5 drop reaches the WebView", () => {
    expect(chatWindow?.dragDropEnabled).toBe(false);
  });
});
