import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";

type FocusChangedEvent = {
  readonly payload: boolean;
};

type FocusChangedHandler = (event: FocusChangedEvent) => void;

const TAB_LABELS = [
  "General",
  "AI",
  "Desktop pet",
  "Shortcuts",
  "Account",
  "Memory",
  "About",
] as const;

type TabLabel = (typeof TAB_LABELS)[number];

type SettingsShortcutCase = {
  readonly key: string;
  readonly modifier: "Ctrl" | "Meta";
  readonly expectedLabel: TabLabel;
};

const SETTINGS_SHORTCUT_CASES = [
  { key: "1", modifier: "Ctrl", expectedLabel: "General" },
  { key: "2", modifier: "Ctrl", expectedLabel: "AI" },
  { key: "3", modifier: "Ctrl", expectedLabel: "Desktop pet" },
  { key: "4", modifier: "Ctrl", expectedLabel: "Shortcuts" },
  { key: "5", modifier: "Ctrl", expectedLabel: "Account" },
  { key: "6", modifier: "Ctrl", expectedLabel: "Memory" },
  { key: "7", modifier: "Ctrl", expectedLabel: "About" },
  { key: "4", modifier: "Meta", expectedLabel: "Shortcuts" },
] as const satisfies readonly SettingsShortcutCase[];

let focusChangedHandler: FocusChangedHandler | null = null;

const unlisten = mock<() => void>(() => undefined);
const onFocusChanged = mock<
  (handler: FocusChangedHandler) => Promise<() => void>
>((handler) => {
  focusChangedHandler = handler;
  return Promise.resolve(unlisten);
});

mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged }),
}));

const { SettingsKeyboardNavigation } = await import("./SettingsKeyboardNavigation");

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

function SettingsTabsFixture({
  children,
  clickedTabs = [],
}: {
  readonly children?: ReactNode;
  readonly clickedTabs?: TabLabel[];
}) {
  const [activeLabel, setActiveLabel] = useState<TabLabel>("General");
  return (
    <>
      <nav aria-label="settings">
        {TAB_LABELS.map((label) => (
          <button
            key={label}
            className={`set-tab${activeLabel === label ? " set-tab-active" : ""}`}
            onClick={() => {
              clickedTabs.push(label);
              setActiveLabel(label);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <main>{children}</main>
      <SettingsKeyboardNavigation />
    </>
  );
}

beforeEach(() => {
  focusChangedHandler = null;
  unlisten.mockClear();
  onFocusChanged.mockClear();
});

afterEach(cleanup);

describe("SettingsKeyboardNavigation", () => {
  test("focuses the active settings tab when the Tauri settings window gains focus", async () => {
    render(<SettingsTabsFixture />);

    emitFocusChange(true);

    const generalTab = screen.getByRole("button", { name: "General" });
    await waitFor(() => {
      expect(document.activeElement).toBe(generalTab);
    });
  });

  test("preserves CC Switch action focus when the Tauri settings window is reactivated", async () => {
    render(
      <SettingsTabsFixture>
        <button type="button" className="set-ccswitch-action">
          Configure CC Switch
        </button>
      </SettingsTabsFixture>,
    );

    const configureButton = screen.getByRole("button", {
      name: "Configure CC Switch",
    });
    configureButton.focus();

    emitFocusChange(true);

    await flushScheduledFocus();

    await waitFor(() => {
      expect(activeElementLabel()).toBe("Configure CC Switch");
    });
  });

  test("preserves focused settings content controls when the Tauri settings window is reactivated", async () => {
    render(
      <SettingsTabsFixture>
        <input aria-label="api key" />
      </SettingsTabsFixture>,
    );

    const apiKeyInput = screen.getByLabelText("api key");
    apiKeyInput.focus();

    emitFocusChange(true);

    await flushScheduledFocus();

    await waitFor(() => {
      expect(activeElementLabel()).toBe("api key");
    });
  });

  test("selects and focuses the AI tab from the second settings shortcut", async () => {
    render(<SettingsTabsFixture />);

    const event = new KeyboardEvent("keydown", {
      key: "2",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });

    const aiTab = screen.getByRole("button", { name: "AI" });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(aiTab.classList.contains("set-tab-active")).toBe(true);
      expect(document.activeElement).toBe(aiTab);
    });
  });

  test("focuses AI base URL before tab shortcuts when Ctrl+Shift+B is pressed", async () => {
    render(
      <SettingsTabsFixture>
        <input className="set-ai-base-url" aria-label="Base URL" />
      </SettingsTabsFixture>,
    );

    const event = new KeyboardEvent("keydown", {
      key: "B",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("Base URL"));
    });
  });

  test("clicks and focuses verify from Ctrl+Shift+V without hijacking ordinary paste", async () => {
    const clicked: string[] = [];
    render(
      <SettingsTabsFixture>
        <button
          type="button"
          className="set-verify"
          onClick={() => clicked.push("verify")}
        >
          Verify
        </button>
      </SettingsTabsFixture>,
    );

    const paste = new KeyboardEvent("keydown", {
      key: "v",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(false);
    expect(clicked).toEqual([]);

    const verify = new KeyboardEvent("keydown", {
      key: "V",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(verify);
    });

    expect(verify.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(clicked).toEqual(["verify"]);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Verify" }));
    });
  });

  test("clicks and focuses CC Switch setup from Ctrl+Shift+C", async () => {
    const clicked: string[] = [];
    render(
      <SettingsTabsFixture>
        <button
          type="button"
          className="set-ccswitch-action"
          onClick={() => clicked.push("ccswitch")}
        >
          Configure CC Switch
        </button>
      </SettingsTabsFixture>,
    );

    const event = new KeyboardEvent("keydown", {
      key: "c",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(clicked).toEqual(["ccswitch"]);
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Configure CC Switch" }),
      );
    });
  });

  for (const shortcutCase of SETTINGS_SHORTCUT_CASES) {
    test(`selects, clicks, and focuses the ${shortcutCase.expectedLabel} tab from ${shortcutCase.modifier}+${shortcutCase.key}`, async () => {
      const clickedTabs: TabLabel[] = [];
      render(<SettingsTabsFixture clickedTabs={clickedTabs} />);

      const event = new KeyboardEvent("keydown", {
        key: shortcutCase.key,
        ctrlKey: shortcutCase.modifier === "Ctrl",
        metaKey: shortcutCase.modifier === "Meta",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        document.dispatchEvent(event);
      });

      const expectedTab = screen.getByRole("button", {
        name: shortcutCase.expectedLabel,
      });
      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => {
        const activeTabLabels = Array.from(
          document.querySelectorAll(".set-tab-active"),
          (element) => element.textContent,
        );
        expect(clickedTabs).toEqual([shortcutCase.expectedLabel]);
        expect(activeTabLabels).toEqual([shortcutCase.expectedLabel]);
        expect(document.activeElement).toBe(expectedTab);
      });
    });
  }
});
