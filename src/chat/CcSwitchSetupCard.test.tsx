import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CcSwitchSetupCard,
  dict,
  draft,
  installDefaultInvoke,
  invoke,
  prepared,
  renderCard,
  selection,
} from "../testing/CcSwitchSetupCardHarness";

beforeEach(installDefaultInvoke);
afterEach(cleanup);

describe("CC Switch secure setup card", () => {
  test("renders the credential boundary accessibly in every supported locale", () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP", "ko-KR"] as const) {
      const labels = dict(locale);
      render(<CcSwitchSetupCard t={labels} draft={draft} onClose={() => undefined} />);
      const region = screen.getByRole("region", { name: labels.ccSwitchSetupTitle });
      expect(within(region).getByRole("status").textContent).toBe(
        labels.ccSwitchSetupState("draft"),
      );
      expect(screen.getByLabelText(labels.apiKey)).toBeDefined();
      expect(screen.getByRole("button", { name: labels.ccSwitchSetupValidate })).toBeDefined();
      cleanup();
    }
  });

  test("renders localized native validation errors in all four locales", async () => {
    const cases = [
      ["zh-CN", "API Key 被拒绝。"],
      ["en-US", "The API key was rejected."],
      ["ja-JP", "API Key が拒否されました。"],
      ["ko-KR", "API Key가 거부되었습니다."],
    ] as const;
    for (const [locale, expected] of cases) {
      invoke.mockImplementation((command: string) => {
        if (command === "ccswitch_capability_status") return Promise.resolve({ kind: "ready" });
        if (command === "prepare_ccswitch_opencode_provider") {
          return Promise.reject({ code: "ccswitch_invalid_api_key" });
        }
        return Promise.resolve(undefined);
      });
      const labels = dict(locale);
      render(<CcSwitchSetupCard t={labels} draft={draft} onClose={() => undefined} />);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText(labels.apiKey), "invalid-test-key");
      await user.click(screen.getByRole("button", { name: labels.ccSwitchSetupValidate }));
      expect(await screen.findByText(expected)).toBeDefined();
      cleanup();
    }
  });

  test("uses the YUME token system for card, controls, focus, and terminal states", async () => {
    const css = await Bun.file(new URL("./chat.css", import.meta.url)).text();
    const start = css.indexOf(".ccswitch-card");
    const end = css.indexOf(".chat-input-row", start);
    const block = css.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain("var(--surface-raised)");
    expect(block).toContain("var(--line-strong)");
    expect(block).toContain("var(--s-2)");
    expect(block).toContain("var(--r-sm)");
    expect(block).toContain("focus-visible");
    expect(block).toContain(".ccswitch-state-panel select");
    expect(block).toContain("line-break: strict");
    expect(block).toContain("overflow-wrap: break-word");
    expect(block).toContain("word-break: normal");
    expect(block).toContain("flex-wrap: wrap");
    expect(block).toContain("width: 100%");
    expect(block).toContain("var(--danger)");
    expect(block).toContain("var(--success)");
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/iu);
    expect(block).not.toMatch(/\b(?:2|4|6|8|10|12|28|32)px\b/u);
  });

  test("clears the uncontrolled password field before the native preparation resolves", async () => {
    let resolvePrepare: (value: unknown) => void = () => undefined;
    invoke.mockImplementation((command: string) => {
      if (command === "ccswitch_capability_status") return Promise.resolve({ kind: "ready" });
      if (command === "prepare_ccswitch_opencode_provider") {
        return new Promise((resolve) => {
          resolvePrepare = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    renderCard();
    const user = userEvent.setup();
    const password = screen.getByLabelText("API Key") as HTMLInputElement;
    const runtimeCanary = `card-${crypto.randomUUID()}`;
    await user.type(password, runtimeCanary);
    await user.click(screen.getByRole("button", { name: "Validate and prepare" }));
    expect(password.value).toBe("");
    expect(
      invoke.mock.calls.find(([command]) => command === "prepare_ccswitch_opencode_provider")?.[1],
    ).toEqual({
      input: {
        providerName: "YUME",
        endpoint: "https://api.example.test/v1",
        apiKey: runtimeCanary,
      },
    });
    resolvePrepare(selection);
    expect(await screen.findByRole("combobox", { name: "Model" })).toBeDefined();
    expect(screen.queryByText(runtimeCanary)).toBeNull();
  });

  test("creates the launch ticket from the native selection without resending key, catalog, or hash", async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("API Key"), "test-key");
    const submit = screen.getByRole("button", { name: "Validate and prepare" });
    await Promise.all([user.click(submit), user.click(submit)]);
    await waitFor(() =>
      expect(
        invoke.mock.calls.filter(([command]) => command === "prepare_ccswitch_opencode_provider"),
      ).toHaveLength(1),
    );
    await user.selectOptions(await screen.findByRole("combobox", { name: "Model" }), "model-a");
    await Promise.all([
      user.click(screen.getByRole("button", { name: "Continue" })),
      user.click(screen.getByRole("button", { name: "Continue" })),
    ]);
    await waitFor(() => {
      expect(invoke.mock.calls.filter(([command]) => command === "select_ccswitch_opencode_model")).toEqual([
        ["select_ccswitch_opencode_model", { input: { selectionId: "selection-1", selectedModel: "model-a" } }],
      ]);
    });
    const disclosure = screen.getByRole("alertdialog", { name: "Secure OpenCode setup" });
    expect(disclosure.getAttribute("aria-labelledby")).toBe("ccswitch-card-title");
    expect(document.activeElement).toBe(disclosure);
    expect(invoke.mock.calls.some(([command]) => command === "launch_ccswitch_opencode_import")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Open CC Switch" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("launch_ccswitch_opencode_import", {
        request: {
          ticketId: prepared.receipt.ticketId,
          switchImmediately: true,
          acceptedProcessArgumentDisclosure: true,
        },
      });
    });
  });

  test("supports keyboard submission and keyboard model confirmation", async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("API Key"), "keyboard-test-key{Enter}");
    const model = await screen.findByRole("combobox", { name: "Model" });
    await user.selectOptions(model, "model-b");
    screen.getByRole("button", { name: "Continue" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/temporarily exposes the API key/i)).toBeDefined();
  });
});
