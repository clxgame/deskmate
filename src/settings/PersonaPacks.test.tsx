import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Persona pack management tests: listing install state, importing from the
 * native picker, cancelling, removing, and resetting the active persona when its
 * pack is removed.
 */

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const open = mock<() => Promise<string | null>>(() => Promise.resolve(null));

// Keep the module's other exports so replacing invoke does not hide them from
// modules loaded later in the same process.
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/plugin-dialog", () => ({ open }));

const { PersonaPacks } = await import("./PersonaPacks");
const { dict } = await import("../lib/i18n");

const t = dict("zh-CN");

interface Harness {
  onInstalledChange: ReturnType<typeof mock>;
  onActivePersonaRemoved: ReturnType<typeof mock>;
  onActivePersonaChange: ReturnType<typeof mock>;
}

function renderPacks(
  overrides: {
    installed?: { packId: string; version: string; personaIds: string[] }[];
    activePersonaId?: string;
  } = {},
): Harness {
  const onInstalledChange = mock(() => {});
  const onActivePersonaRemoved = mock(() => {});
  const onActivePersonaChange = mock((_personaId: string) => {});
  render(
    <PersonaPacks
      t={t}
      language="zh-CN"
      installed={overrides.installed ?? []}
      onInstalledChange={onInstalledChange}
      onActivePersonaRemoved={onActivePersonaRemoved}
      onActivePersonaChange={onActivePersonaChange}
      activePersonaId={overrides.activePersonaId ?? "xiaozhu"}
    />,
  );
  return { onInstalledChange, onActivePersonaRemoved, onActivePersonaChange };
}

const confirmSpy = mock((_message?: string) => true);

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(() => Promise.resolve([]));
  open.mockReset();
  open.mockImplementation(() => Promise.resolve(null));
  confirmSpy.mockReset();
  confirmSpy.mockImplementation(() => true);
  globalThis.window.confirm = (message) => confirmSpy(message);
});

afterEach(() => {
  cleanup();
});

describe("persona pack management", () => {
  test("lists every known pack with its install state", async () => {
    renderPacks();

    expect(await screen.findByRole("heading", { name: "角色包" })).toBeDefined();
    expect(screen.getByText("1 个包可用 · 1 个角色")).toBeDefined();

    const builtin = screen.getByRole("article", { name: "小著" });
    const builtinTooltip = within(builtin).getByRole("tooltip");
    expect(builtinTooltip.textContent).toContain("随应用提供，始终可用");
    expect(within(builtin).getAllByText("随应用提供，始终可用")).toHaveLength(1);
    expect(within(builtin).getByLabelText("1 个角色可用")).toBeDefined();

    const optional = screen.getByRole("article", { name: "aki 团子" });
    const optionalTooltip = within(optional).getByRole("tooltip");
    expect(optionalTooltip.textContent).toContain("离线扩展包，通过 .dmpack 文件导入");
    expect(within(optional).getAllByText("离线扩展包，通过 .dmpack 文件导入")).toHaveLength(1);
    expect(within(optional).getByLabelText("包含 25 个角色")).toBeDefined();
    const importButton = within(optional).getByRole("button", { name: "导入" });
    expect(importButton.textContent).toBe("");
    expect(importButton.querySelector("svg")).toBeDefined();

    // The built-in pack can never be removed, so it has no remove button.
    expect(screen.queryByRole("button", { name: "卸载" })).toBeNull();
  });

  test("offers removal only for an installed removable pack", async () => {
    renderPacks({
      installed: [{ packId: "aki", version: "1.0.0", personaIds: ["changli"] }],
    });

    const installed = await screen.findByRole("article", { name: "aki 团子" });
    expect(within(installed).getByText("已安装 · v1.0.0")).toBeDefined();
    expect(within(installed).getByLabelText("1 个角色可用")).toBeDefined();
    const uninstallButton = await screen.findByRole("button", { name: "卸载" });
    expect(uninstallButton.textContent).toBe("");
    expect(uninstallButton.querySelector("svg")).toBeDefined();
  });

  test("filters the role selector to the selected pack", async () => {
    const harness = renderPacks({
      installed: [{ packId: "aki", version: "1.0.0", personaIds: ["changli"] }],
      activePersonaId: "changli",
    });

    const packSelector = await screen.findByRole("combobox", { name: "角色包" });
    const selector = await screen.findByRole("combobox", { name: "角色" });
    expect(within(selector).queryByRole("option", { name: "小著" })).toBeNull();
    expect(within(selector).getByRole("option", { name: "长离" })).toBeDefined();

    const user = userEvent.setup();
    await user.selectOptions(selector, "changli");
    await user.selectOptions(packSelector, "aki");

    expect(harness.onActivePersonaChange).toHaveBeenCalledWith("changli");
  });

  test("imports the file chosen in the native picker", async () => {
    // A WebView file input cannot supply a real path, so the native picker is
    // the only way import_pack can receive one.
    open.mockImplementation(() => Promise.resolve("C:\\packs\\aki.dmpack"));
    invoke.mockImplementation((command) => {
      if (command === "import_pack") {
        return Promise.resolve({
          packId: "aki",
          version: "1.0.0",
          personaIds: ["changli"],
          sha256: "a".repeat(64),
        });
      }
      return Promise.resolve([]);
    });
    renderPacks();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "导入" }));

    await waitFor(() => {
      const call = invoke.mock.calls.find(([command]) => command === "import_pack");
      expect(call).toBeDefined();
      if (call === undefined) throw new Error("import_pack was not called");
      expect(call[1]).toEqual({ path: "C:\\packs\\aki.dmpack" });
    });
    expect(await screen.findByText("角色包导入成功")).toBeDefined();
  });

  test("does nothing when the picker is cancelled", async () => {
    open.mockImplementation(() => Promise.resolve(null));
    renderPacks();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "导入" }));

    await waitFor(() => {
      expect(
        invoke.mock.calls.some(([command]) => command === "import_pack"),
      ).toBe(false);
    });
  });

  test("surfaces the backend message when an import fails", async () => {
    open.mockImplementation(() => Promise.resolve("C:\\packs\\evil.dmpack"));
    invoke.mockImplementation((command) => {
      if (command === "import_pack") {
        // The backend already localizes its errors; they must not be replaced.
        return Promise.reject(new Error("角色包含有不安全的路径: ../evil.md"));
      }
      return Promise.resolve([]);
    });
    renderPacks();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "导入" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "不安全的路径",
    );
  });

  test("removes a pack after confirmation", async () => {
    invoke.mockImplementation((command) => {
      if (command === "uninstall_pack") return Promise.resolve(undefined);
      return Promise.resolve([]);
    });
    renderPacks({
      installed: [{ packId: "aki", version: "1.0.0", personaIds: ["changli"] }],
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "卸载" }));

    await waitFor(() => {
      const call = invoke.mock.calls.find(([command]) => command === "uninstall_pack");
      expect(call).toBeDefined();
      if (call === undefined) throw new Error("uninstall_pack was not called");
      expect(call[1]).toEqual({ packId: "aki" });
    });
    expect(await screen.findByText("角色包已卸载")).toBeDefined();
  });

  test("keeps the pack when the confirmation is declined", async () => {
    confirmSpy.mockImplementation(() => false);
    renderPacks({
      installed: [{ packId: "aki", version: "1.0.0", personaIds: ["changli"] }],
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "卸载" }));

    await waitFor(() => {
      expect(
        invoke.mock.calls.some(([command]) => command === "uninstall_pack"),
      ).toBe(false);
    });
  });

  test("resets the active persona when its own pack is removed", async () => {
    // Otherwise the pet would be left pointing at a model that no longer exists.
    invoke.mockImplementation((command) => {
      if (command === "uninstall_pack") return Promise.resolve(undefined);
      return Promise.resolve([]);
    });
    const harness = renderPacks({
      installed: [{ packId: "aki", version: "1.0.0", personaIds: ["changli"] }],
      activePersonaId: "changli",
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "卸载" }));

    await waitFor(() => {
      expect(harness.onActivePersonaRemoved).toHaveBeenCalled();
    });
    expect(await screen.findByText(/已切换回小著/)).toBeDefined();
  });

  test("leaves the active persona alone when another pack is removed", async () => {
    invoke.mockImplementation((command) => {
      if (command === "uninstall_pack") return Promise.resolve(undefined);
      return Promise.resolve([]);
    });
    const harness = renderPacks({
      installed: [{ packId: "aki", version: "1.0.0", personaIds: ["changli"] }],
      activePersonaId: "xiaozhu",
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "卸载" }));

    await waitFor(() => {
      expect(
        invoke.mock.calls.some(([command]) => command === "uninstall_pack"),
      ).toBe(true);
    });
    expect(harness.onActivePersonaRemoved).not.toHaveBeenCalled();
  });

  test("refreshes install state from the backend on mount", async () => {
    invoke.mockImplementation((command) => {
      if (command === "installed_packs") {
        return Promise.resolve([
          { packId: "aki", version: "2.0.0", personaIds: ["changli"] },
        ]);
      }
      return Promise.resolve([]);
    });
    const harness = renderPacks();

    await waitFor(() => {
      expect(harness.onInstalledChange).toHaveBeenCalledWith([
        { packId: "aki", version: "2.0.0", personaIds: ["changli"] },
      ]);
    });
  });
});
