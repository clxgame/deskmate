import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";

const calls: Array<{ command: string; args?: object }> = [];
function installHost() { mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string, args?: object) => {
  calls.push({ command, args });
  return command === "history_catalog_list" ? { items: [], total: 0, hasMore: false, offline: false, errors: [], directories: [] } : null;
} })); }
installHost();
beforeEach(installHost);
const { catalogList, catalogMutate, historyDateBounds } = await import("./unifiedHistory");
afterEach(() => { calls.length = 0; restoreTauriModuleFixture(); });

test("catalog search sends all metadata filters and a bounded page to the host", async () => {
  await catalogList({ search: "renamed", directory: "C:/a", source: "workbench", archived: false, pinned: true, offset: 1000, limit: 50 }, false);
  expect(calls[0]).toEqual({ command: "history_catalog_list", args: { query: { search: "renamed", directory: "C:/a", source: "workbench", archived: false, pinned: true, offset: 1000, limit: 50 }, refresh: false } });
});
test("mutations preserve composite identity and explicit deletion confirmation", async () => {
  const key = 'native:["sidecar","c:/two","same-id"]';
  await catalogMutate(key, { action: "delete", confirmed: true });
  expect(calls[0]).toEqual({ command: "history_catalog_mutate", args: { key, mutation: { action: "delete", confirmed: true } } });
});
test("date bounds include the selected local day, not the following midnight", () => {
  const bounds = historyDateBounds("2026-09-24", "2026-09-24");
  expect(bounds.from).toBe(new Date(2026, 8, 24).getTime());
  expect(bounds.to).toBe(new Date(2026, 8, 25).getTime() - 1);
  expect(historyDateBounds("", "")).toEqual({});
});
