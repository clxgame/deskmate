import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

type FocusChangedEvent = {
  readonly payload: boolean;
};

type FocusChangedHandler = (event: FocusChangedEvent) => void;

let focusChangedHandler: FocusChangedHandler | null = null;

const invoke = mock<(command: string) => Promise<unknown>>(() =>
  Promise.resolve(undefined),
);
const unlisten = mock<() => void>(() => undefined);
const onFocusChanged = mock<
  (handler: FocusChangedHandler) => Promise<() => void>
>((handler) => {
  focusChangedHandler = handler;
  return Promise.resolve(unlisten);
});

mock.module("@tauri-apps/api/core", () => ({ invoke }));
mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged }),
}));

const { ChatKeyboardNavigation } = await import("./ChatKeyboardNavigation");

function emitFocusChange(payload: boolean): void {
  if (focusChangedHandler === null) {
    throw new Error("Focus listener was not registered");
  }
  focusChangedHandler({ payload });
}

function flushScheduledFocus(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function activeElementLabel(): string {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return "";
  return activeElement.getAttribute("aria-label") ?? activeElement.textContent ?? activeElement.tagName;
}

beforeEach(() => {
  focusChangedHandler = null;
  invoke.mockClear();
  unlisten.mockClear();
  onFocusChanged.mockClear();
});

afterEach(cleanup);

describe("ChatKeyboardNavigation", () => {
  test("focuses the chat input when the Tauri chat window gains focus", async () => {
    render(
      <>
        <textarea className="chat-input" aria-label="message" />
        <ChatKeyboardNavigation />
      </>,
    );

    emitFocusChange(true);

    const input = screen.getByLabelText("message");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  test("preserves dialog button focus when the Tauri chat window is reactivated", async () => {
    render(
      <>
        <textarea className="chat-input" aria-label="message" />
        <div role="dialog" aria-label="memory confirmation">
          <button type="button">Decline</button>
        </div>
        <ChatKeyboardNavigation />
      </>,
    );

    const declineButton = screen.getByRole("button", { name: "Decline" });
    declineButton.focus();

    emitFocusChange(true);

    await flushScheduledFocus();

    await waitFor(() => {
      expect(activeElementLabel()).toBe("Decline");
    });
  });

  test("preserves focused chat input controls when the Tauri chat window is reactivated", async () => {
    render(
      <>
        <textarea className="chat-input" aria-label="message" />
        <input aria-label="attachment caption" />
        <ChatKeyboardNavigation />
      </>,
    );

    const captionInput = screen.getByLabelText("attachment caption");
    captionInput.focus();

    emitFocusChange(true);

    await flushScheduledFocus();

    await waitFor(() => {
      expect(activeElementLabel()).toBe("attachment caption");
    });
  });

  test("opens settings from the chat shortcut without typing a comma", async () => {
    render(<ChatKeyboardNavigation />);

    const event = new KeyboardEvent("keydown", {
      key: ",",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_settings");
    });
  });

  test("opens settings from the Meta chat shortcut without typing a comma", async () => {
    render(<ChatKeyboardNavigation />);

    const event = new KeyboardEvent("keydown", {
      key: ",",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_settings");
    });
  });
});
