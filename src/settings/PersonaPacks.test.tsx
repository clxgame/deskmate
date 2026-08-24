import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
}

function renderPacks(
  overrides: {
    installed?: { packId: string; version: string; personaIds: string[] }[];
    activePersonaId?: string;
  } = {},
): Harness {
  const onInstalledChange = mock(() => {});
  const onActivePersonaRemoved = mock(() => {});
  render(
    <PersonaPacks
      t={t}
      language="zh-CN"
      installed={overrides.installed ?? []}
      onInstalledChange={onInstalledChange}
      onActivePersonaRemoved={onActivePersonaRemoved}
      activePersonaId={overrides.activePersonaId ?? "xiaozhu"}
    />,
  );
  return { onInstalledChange, onActivePersonaRemoved };
}

const confirmSpy = mock(() => true);

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(() => Promise.resolve([]));
  open.mockReset();
  open.mockImplementation(() => Promise.resolve(null));
  confirmSpy.mockReset();
  confirmSpy.mockImplementation(() => true);
  globalThis.window.confirm = confirmSpy as unknown as typeof window.confirm;
});

afterEach(() => {
  cleanup();
});

describe("persona pack management", () => {
  test("lists every known pack with its install state", async () => {
    renderPacks();

    // The built-in pack can never be removed, so it has no remove button.
    expect(await screen.findByText("AI 替身")).toBeDefined();
    expect(screen.getByText("aki 团子")).toBeDefined();
    expect(screen.getAllByText(/内置/).length).toBeGreaterThan(0);
    expect(screen.getByText(/未安装/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "卸载" })).toBeNull();
  });

  test("offers removal only for an installed removable pack", async () => {
    renderPacks({
      installed: [{ packId: "aki", version: "1.0.0", personaIds: ["changli"] }],
    });

    expect(await screen.findByRole("button", { name: "卸载" })).toBeDefined();
    expect(screen.getByText(/已安装/)).toBeDefined();
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
    await user.click(await screen.findByRole("button", { name: "导入角色包" }));

    await waitFor(() => {
      const call = invoke.mock.calls.find(([command]) => command === "import_pack");
      expect(call).toBeDefined();
      expect(call![1]).toEqual({ path: "C:\\packs\\aki.dmpack" });
    });
    expect(await screen.findByText("角色包导入成功")).toBeDefined();
  });

  test("does nothing when the picker is cancelled", async () => {
    open.mockImplementation(() => Promise.resolve(null));
    renderPacks();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "导入角色包" }));

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
    await user.click(await screen.findByRole("button", { name: "导入角色包" }));

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
      expect(call![1]).toEqual({ packId: "aki" });
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
