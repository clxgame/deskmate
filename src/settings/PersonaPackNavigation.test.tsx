import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InstalledPack } from "../lib/packs";

const aki: InstalledPack = {
  packId: "aki", version: "1.0.1", personaIds: ["changli", "jinxi"],
  name: { zh: "aki 团子", en: "aki Dango", ja: "aki 団子", ko: "aki 당고" },
};
const second: InstalledPack = {
  packId: "import", version: "1.0.0", personaIds: ["future-role"],
  name: { zh: "第二个包", en: "Second pack", ja: "第二パック", ko: "두 번째 팩" },
};
let installed: InstalledPack[] = [];
let incoming: InstalledPack[] = [];
const selections = mock((_id: string) => {});
const invoke = mock(async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  switch (command) {
    case "installed_packs": return installed;
    case "import_pack": {
      const next = incoming.shift();
      if (next === undefined) throw new Error("No selected package");
      installed = [...installed.filter((pack) => pack.packId !== next.packId), next];
      return { ...next, sha256: "a".repeat(64) };
    }
    case "uninstall_pack":
      installed = installed.filter((pack) => pack.packId !== args?.packId);
      return undefined;
    default: throw new Error(`Unexpected command: ${command}`);
  }
});
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve("C:\\packs\\selected.dmpack") }));
const { PersonaPacks } = await import("./PersonaPacks");
const { dict } = await import("../lib/i18n");

function Harness() {
  const [packs, setPacks] = useState<InstalledPack[]>([]);
  const [active, setActive] = useState("xiaozhu");
  return <PersonaPacks t={dict("zh-CN")} language="zh-CN" installed={packs}
    onInstalledChange={setPacks} activePersonaId={active}
    onActivePersonaChange={(id) => { selections(id); setActive(id); }}
    onActivePersonaRemoved={() => setActive("xiaozhu")} />;
}

beforeEach(() => { installed = []; incoming = []; selections.mockClear(); });
afterEach(cleanup);

test("keeps one import tile last after importing two distinct packages", async () => {
  incoming = [aki, second];
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "导入" }));
  await screen.findByRole("article", { name: "aki 团子" });
  await user.click(screen.getByRole("button", { name: "导入" }));
  await screen.findByRole("article", { name: "第二个包" });
  const cards = within(screen.getByRole("list")).getAllByRole("article");
  expect(cards).toHaveLength(4);
  expect(within(cards[3]).getByRole("button", { name: "导入" })).toBeDefined();
  expect(screen.getAllByRole("button", { name: "导入" })).toHaveLength(1);
});

test("updates a matching pack id without adding a duplicate card or removing import", async () => {
  installed = [aki];
  incoming = [{ ...aki, version: "2.0.0" }];
  render(<Harness />);
  await screen.findByRole("article", { name: "aki 团子" });
  await userEvent.setup().click(screen.getByRole("button", { name: "导入" }));
  await screen.findByText("已安装 · v2.0.0");
  expect(screen.getAllByRole("article", { name: "aki 团子" })).toHaveLength(1);
  expect(within(screen.getByRole("list")).getAllByRole("article")).toHaveLength(3);
});

test("selects a pack by its icon and filters the sole role dropdown", async () => {
  installed = [aki];
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "aki 团子" }));
  expect(screen.queryByRole("combobox", { name: "角色包" })).toBeNull();
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  const role = screen.getByRole("combobox", { name: "角色" });
  expect(within(role).getAllByRole("option").map((option) => option.textContent)).toEqual(["长离", "今汐"]);
  expect(screen.getByRole("button", { name: "aki 团子", pressed: true })).toBeDefined();
  await user.selectOptions(role, "jinxi");
  await user.click(screen.getByRole("button", { name: "aki 团子" }));
  expect(selections.mock.calls.map(([id]) => id)).toEqual(["changli", "jinxi"]);
  await user.click(screen.getByRole("button", { name: "小著" }));
  expect(within(role).getAllByRole("option").map((option) => option.textContent)).toEqual(["小著"]);
  expect(screen.getByRole("button", { name: "小著", pressed: true })).toBeDefined();
});

test("supports keyboard selection on package icons", async () => {
  installed = [aki];
  render(<Harness />);
  await screen.findByRole("article", { name: "aki 团子" });
  const user = userEvent.setup();
  await user.tab();
  await user.tab();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: "aki 团子", pressed: true })).toBeDefined();
  expect(selections).toHaveBeenCalledWith("changli");
});

test("uninstall controls do not select an unselected pack", async () => {
  installed = [aki];
  render(<Harness />);
  const tile = await screen.findByRole("article", { name: "aki 团子" });
  const user = userEvent.setup();
  await user.click(within(tile).getByRole("button", { name: "卸载" }));
  expect(selections).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "小著", pressed: true })).toBeDefined();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByRole("article", { name: "aki 团子" })).toBeDefined();
});

test("returns to the built-in icon when its selected pack is removed", async () => {
  installed = [aki, second];
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "aki 团子" }));
  await user.click(within(screen.getByRole("article", { name: "aki 团子" })).getByRole("button", { name: "卸载" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(screen.queryByRole("article", { name: "aki 团子" })).toBeNull());
  expect(screen.getByRole("button", { name: "小著", pressed: true })).toBeDefined();
  expect(screen.getByRole("article", { name: "第二个包" })).toBeDefined();
  const cards = within(screen.getByRole("list")).getAllByRole("article");
  expect(within(cards[2]).getByRole("button", { name: "导入" })).toBeDefined();
});

test("keeps unknown pack roles out of the renderer and exposes an empty selected state", async () => {
  installed = [{ ...second, personaIds: ["changli", "future-role"] }];
  render(<Harness />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "第二个包" }));
  expect(screen.getByRole("button", { name: "第二个包", pressed: true })).toBeDefined();
  const role = screen.getByRole("combobox", { name: "角色" });
  expect(role.hasAttribute("disabled")).toBe(true);
  expect(within(role).getByRole("option", { name: "0 个角色可用" })).toBeDefined();
  expect(selections).not.toHaveBeenCalled();
});

test("keeps accessible labels and descriptions unique for reserved-looking package ids", async () => {
  installed = [aki, second, { packId: "aki-tooltip", version: "1.0.0", personaIds: [] }];
  render(<Harness />);
  await screen.findByRole("article", { name: "aki-tooltip" });
  const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const card of within(screen.getByRole("list")).getAllByRole("article")) {
    const tooltip = within(card).getByRole("tooltip");
    expect(document.getElementById(card.getAttribute("aria-describedby") ?? "")).toBe(tooltip);
  }
});
