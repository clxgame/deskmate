import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as tauriCore from "@tauri-apps/api/core";
import userEvent from "@testing-library/user-event";
import { dict } from "../lib/i18n";
import { SettingsNavigation, type TabId } from "./SettingsNavigation";
import type { ReactNode } from "react";
import { useState } from "react";

type FocusChangedEvent = {
  readonly payload: boolean;
};

type FocusChangedHandler = (event: FocusChangedEvent) => void;

const TAB_LABELS = [
  "General",
  "AI",
  "Tool permissions",
  "Widget",
  "Shortcuts",
  "Desktop pet",
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
  { key: "3", modifier: "Ctrl", expectedLabel: "Tool permissions" },
  { key: "4", modifier: "Ctrl", expectedLabel: "Widget" },
  { key: "5", modifier: "Ctrl", expectedLabel: "Shortcuts" },
  { key: "6", modifier: "Ctrl", expectedLabel: "Desktop pet" },
  { key: "7", modifier: "Ctrl", expectedLabel: "Memory" },
  { key: "8", modifier: "Ctrl", expectedLabel: "About" },
  { key: "8", modifier: "Meta", expectedLabel: "About" },
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
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke: () => Promise.resolve([]) }));
const { PersonaPacks } = await import("./PersonaPacks");

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
  const [tab, setTab] = useState<TabId>("general");
  return (
    <>
      <SettingsNavigation tab={tab} t={dict("en-US")} onSelect={(id) => {
        const label = document.getElementById(`set-category-${id}`)?.textContent ?? "";
        clickedTabs.push(label as TabLabel);
        setTab(id);
      }} />
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
    await flushScheduledFocus();

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

  test("ignores global settings shortcuts while a modal dialog is open", () => {
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
        <dialog open aria-label="Confirm deletion">
          <button type="button">Cancel</button>
        </dialog>
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

    expect(clicked).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
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

for (const modifier of ["Control", "Meta"]) {
  test(`keeps real pack confirmation open during ${modifier} navigation and resumes after cancel`, async () => {
    const clickedTabs: TabLabel[] = [];
    const t = dict("zh-CN");
    render(<SettingsTabsFixture clickedTabs={clickedTabs}>
      <PersonaPacks t={t} language="zh-CN"
        installed={[{ packId: "aki", version: "1.0.0", personaIds: ["changli"] }]}
        onInstalledChange={() => {}} activePersonaId="xiaozhu"
        onActivePersonaChange={() => {}} onActivePersonaRemoved={() => {}} />
    </SettingsTabsFixture>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "卸载" }));
    expect(screen.getByRole("alertdialog")).toBeDefined();
    await user.keyboard(`{${modifier}>}8{/${modifier}}`);
    expect(clickedTabs).toEqual([]);
    expect(screen.getByRole("alertdialog")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.keyboard(`{${modifier}>}8{/${modifier}}`);
    expect(clickedTabs).toEqual(["About"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "About" }));
  });
}

for (const hidden of [false, true]) {
  test(`ARIA dialog shortcut guard respects hidden ancestor: ${hidden}`, async () => {
    const clickedTabs: TabLabel[] = [];
    const verify = mock(() => {});
    render(<SettingsTabsFixture clickedTabs={clickedTabs}>
      <button className="set-verify" onClick={verify}>Verify</button>
      <div hidden={hidden}><div role="dialog" aria-modal="true">Confirm</div></div>
    </SettingsTabsFixture>);
    const user = userEvent.setup();
    await user.keyboard('{Control>}8{/Control}');
    await user.keyboard('{Control>}{Shift>}v{/Shift}{/Control}');
    expect(clickedTabs).toEqual(hidden ? ["About"] : []);
    expect(verify.mock.calls.length).toBe(hidden ? 1 : 0);
  });
}

test("does not navigate when a shortcut recorder already handled the key", async () => {
  const clickedTabs: TabLabel[] = [];
  render(<SettingsTabsFixture clickedTabs={clickedTabs}>
    <input aria-label="Record shortcut" onKeyDown={(event) => event.preventDefault()} />
  </SettingsTabsFixture>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("textbox", { name: "Record shortcut" }));
  await user.keyboard('{Control>}8{/Control}');
  expect(clickedTabs).toEqual([]);
});
