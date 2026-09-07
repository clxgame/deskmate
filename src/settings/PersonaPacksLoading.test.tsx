import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InstalledPack } from "../lib/packs";

const loadedPack: InstalledPack = {
  packId: "aki",
  version: "1.0.1",
  personaIds: ["changli"],
  name: { zh: "包内封面测试", en: "Loaded cover", ja: "表紙", ko: "표지" },
  thumbnailPath: "C:\\YUME\\packs\\aki\\personas\\changli\\pack-thumbnail.png",
};
let diskPacks: InstalledPack[] = [];
const invoke = mock((command: string): Promise<unknown> => {
  switch (command) {
    case "installed_packs": return Promise.resolve(diskPacks);
    case "import_pack":
      diskPacks = [loadedPack];
      return Promise.resolve({ ...loadedPack, sha256: "a".repeat(64) });
    case "uninstall_pack":
      diskPacks = [];
      return Promise.resolve(undefined);
    default: return Promise.reject(new Error(`Unexpected command: ${command}`));
  }
});
const convertFileSrc = mock((path: string) => `https://asset.localhost/${encodeURIComponent(path)}`);
const open = mock(() => Promise.resolve("C:\\packs\\aki-1.0.1.dmpack"));
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke, convertFileSrc }));
mock.module("@tauri-apps/plugin-dialog", () => ({ open }));
const { PersonaPacks } = await import("./PersonaPacks");
const { dict } = await import("../lib/i18n");

function Harness() {
  const [installed, setInstalled] = useState<InstalledPack[]>([]);
  const [persona, setPersona] = useState("xiaozhu");
  return <PersonaPacks t={dict("zh-CN")} language="zh-CN" installed={installed}
    onInstalledChange={setInstalled} activePersonaId={persona}
    onActivePersonaChange={setPersona} onActivePersonaRemoved={() => setPersona("xiaozhu")} />;
}

beforeEach(() => { diskPacks = []; convertFileSrc.mockClear(); });
afterEach(cleanup);

test("loads title and cover from disk metadata when the import finishes", async () => {
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "导入" }));
  const tile = await screen.findByRole("article", { name: "包内封面测试" });
  expect(tile.querySelector("img")?.getAttribute("src")).toBe(
    `https://asset.localhost/${encodeURIComponent(loadedPack.thumbnailPath ?? "")}`,
  );
  expect(screen.getByRole("button", { name: "包内封面测试" })).toBeDefined();
});

test("reloads imported display metadata when the settings surface reopens", async () => {
  diskPacks = [loadedPack];
  render(<Harness />);
  const tile = await screen.findByRole("article", { name: "包内封面测试" });
  expect(tile.querySelector("img")).not.toBeNull();
});

test("restores the empty slot and removes its image when the loaded pack is uninstalled", async () => {
  diskPacks = [loadedPack];
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "卸载" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  const emptyTile = await screen.findByRole("article", { name: "导入" });
  expect(emptyTile.querySelector("img")).toBeNull();
  expect(within(emptyTile).queryByRole("heading")).toBeNull();
  expect(screen.queryByRole("button", { name: "包内封面测试" })).toBeNull();
});

test("keeps legacy packs usable with their id when display metadata is absent", async () => {
  diskPacks = [{ packId: "aki", version: "1.0.0", personaIds: ["changli"] }];
  render(<Harness />);
  const tile = await screen.findByRole("article", { name: "aki" });
  expect(tile.querySelector("img")).toBeNull();
  expect(screen.getByRole("button", { name: "aki" })).toBeDefined();
});
