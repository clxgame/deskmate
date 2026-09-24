import { describe, expect, test } from "bun:test";
import { handleHistoryShortcut } from "./history-shortcut";

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "h", code: "KeyH", ctrlKey: true, altKey: true, cancelable: true, ...overrides });
}

describe("workbench shared history shortcut", () => {
  test("opens the host organizer when Ctrl+Alt+H is pressed", async () => {
    // Given a workbench keypress and a host command boundary.
    const event = key();
    const commands: string[] = [];
    // When the shortcut is handled.
    await handleHistoryShortcut(event, async (command) => { commands.push(command); });
    // Then the native organizer opens and browser handling is suppressed.
    expect(commands).toEqual(["show_history_organizer"]);
    expect(event.defaultPrevented).toBe(true);
  });

  test.each([
    { ctrlKey: false }, { altKey: false }, { shiftKey: true }, { metaKey: true },
    { key: "j", code: "KeyJ" }, { repeat: true }, { isComposing: true },
  ])("leaves other keyboard activity untouched: %j", async (overrides) => {
    // Given a keypress that is not an intentional history shortcut.
    const event = key(overrides);
    const commands: string[] = [];
    // When the bridge handles it.
    await handleHistoryShortcut(event, async (command) => { commands.push(command); });
    // Then it neither sends a host command nor consumes input.
    expect(commands).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  test("propagates host failure when opening is rejected", async () => {
    // Given a failed host boundary.
    const failure = new Error("chat window missing");
    // When the shortcut attempts to open history, then rejection remains visible.
    await expect(handleHistoryShortcut(key(), async () => { throw failure; })).rejects.toBe(failure);
  });
});
