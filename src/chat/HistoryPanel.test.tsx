import { afterEach, expect, mock, test } from "bun:test";
import type { CatalogLoadResult, UnifiedHistoryRow } from "../lib/unifiedHistory";

const row: UnifiedHistoryRow = {
  key: "native:fixture:project-a:ses-same",
  identity: { kind: "native", sidecarId: "fixture", directory: "C:/project-a", sessionId: "ses-same" },
  title: "Native", displayTitle: "User title", userTitle: "User title", source: "light_chat",
  created: 1, updated: 2, pinned: false, archived: false, availability: "available",
  ownership: "unowned", runtime: "idle", tombstone: null,
  capabilities: { open: true, openWorkbench: true, send: true, rename: true, pin: true, archive: true, delete: true, readOnlyReason: null },
};
const calls: Array<{ command: string; args?: object }> = [];
let response: CatalogLoadResult = { entry: row, messages: [{ role: "assistant", text: "Actual native message", time: 2, messageId: "msg-native" }] };
let failure: Error | null = null;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: object) => {
    calls.push({ command, args });
    if (failure) throw failure;
    if (command !== "history_catalog_load") throw new Error("unexpected projection access");
    return response;
  },
}));
const { loadSharedConversation, validateSharedConversation } = await import("./sharedConversation");
afterEach(() => { calls.length = 0; failure = null; response = { entry: row, messages: [{ role: "assistant", text: "Actual native message", time: 2, messageId: "msg-native" }] }; });

test("native history reads host-side native messages without a legacy projection or session copy", async () => {
  const loaded = await loadSharedConversation(row);
  expect(loaded.messages[0]?.text).toBe("Actual native message");
  expect(loaded.messages[0]?.messageId).toBe("msg-native");
  expect(loaded.entry.identity).toEqual(row.identity);
  expect(calls).toEqual([{ command: "history_catalog_load", args: { key: row.key } }]);
});

test("native sidecar failure stays a failure instead of falling back to old history text", async () => {
  failure = new Error("sidecar unavailable");
  await expect(loadSharedConversation(row)).rejects.toThrow("sidecar unavailable");
  expect(calls).toHaveLength(1);
});

test("same bare ID returned from a different directory is rejected before rendering", async () => {
  response = { ...response, entry: { ...row, identity: { kind: "native", sidecarId: "fixture", directory: "C:/project-b", sessionId: "ses-same" } } };
  await expect(loadSharedConversation(row)).rejects.toThrow("history identity changed");
});

test("legacy original text remains readable and cannot become a native send target", async () => {
  const legacy: UnifiedHistoryRow = { ...row, key: "legacy:old", identity: { kind: "legacy", historyId: "old" }, source: "legacy", capabilities: { ...row.capabilities, send: false, openWorkbench: false } };
  response = { entry: legacy, messages: [{ role: "user", text: "Original old text", time: 1 }] };
  expect((await loadSharedConversation(legacy)).messages[0]?.text).toBe("Original old text");
  expect(validateSharedConversation(legacy, legacy)).toBeNull();
});
