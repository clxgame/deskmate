import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import type { UnifiedHistoryRow } from "../lib/unifiedHistory";

const nativeRow: UnifiedHistoryRow = {
  key: 'native:["test","c:/project","same-id"]',
  identity: { kind: "native", sidecarId: "test", directory: "c:/project", sessionId: "same-id" },
  title: "Native task", userTitle: null, displayTitle: "Native task", source: "workbench",
  created: 1, updated: 2, pinned: false, archived: false, availability: "available",
  ownership: "workbench", runtime: "idle", tombstone: null,
  capabilities: { open: true, openWorkbench: true, send: false, rename: true, pin: true, archive: true, delete: true, readOnlyReason: "workbench_owned" },
};
const legacyRow: UnifiedHistoryRow = { ...nativeRow, key: "legacy:old", identity: { kind: "legacy", historyId: "old" }, title: "Old notes", displayTitle: "Old notes", source: "legacy", capabilities: { ...nativeRow.capabilities, openWorkbench: false, readOnlyReason: "legacy_text_only" } };
const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
let mutationFails = false;
let listFails = false;
let rows = [nativeRow, legacyRow];
let paginated = false;
function installHost() {
  mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "history_catalog_list") {
      if (listFails) throw new Error("sidecar unavailable");
      return { items: rows, total: paginated ? 1001 : rows.length, hasMore: paginated, offline: false, errors: [], directories: ["c:/project"] };
    }
    if (command === "history_catalog_mutate" && mutationFails) throw new Error("history_agent_running");
    if (command === "history_catalog_mutate" && args?.mutation && typeof args.mutation === "object" && "action" in args.mutation && args.mutation.action === "delete") rows = rows.filter(row => row.key !== args.key);
    return null;
  } }));
  mock.module("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
}
installHost();
const { HistoryOrganizer } = await import("./HistoryOrganizer");
afterEach(() => { cleanup(); calls.length = 0; mutationFails = false; listFails = false; paginated = false; rows = [nativeRow, legacyRow]; restoreTauriModuleFixture(); installHost(); });

test("native and legacy rows open with their complete identity and capability labels", async () => {
  let opened: UnifiedHistoryRow | undefined;
  render(<HistoryOrganizer language="en-US" onOpen={row => { opened = row; }} onClose={() => {}} />);
  await screen.findByText("Native task");
  expect(screen.getByText("Old notes")).toBeDefined();
  expect(screen.getByText("Legacy text only")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Open Native task" }));
  await waitFor(() => expect(opened?.key).toBe(nativeRow.key));
});
test("delete requires confirmation; rejected mutation preserves the row and shows an error", async () => {
  mutationFails = true;
  render(<HistoryOrganizer language="en-US" onOpen={() => {}} onClose={() => {}} />);
  await screen.findByText("Native task");
  fireEvent.click(screen.getByRole("button", { name: "Actions for Native task" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(calls.some(call => call.command === "history_catalog_mutate")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Stop the running task");
  expect(screen.getByRole("button", { name: "Open Native task" })).toBeDefined();
});
test("search and filters reset pagination and query metadata without refreshing native content", async () => {
  render(<HistoryOrganizer language="en-US" onOpen={() => {}} onClose={() => {}} />);
  await screen.findByText("Native task");
  fireEvent.change(screen.getByLabelText("Search titles and projects"), { target: { value: "renamed" } });
  await waitFor(() => expect(calls.filter(call => call.command === "history_catalog_list").at(-1)?.args).toMatchObject({ query: { search: "renamed", offset: 0, limit: 50 }, refresh: false }));
  fireEvent.click(screen.getByRole("button", { name: "Archived" }));
  await waitFor(() => expect(calls.at(-1)?.args).toMatchObject({ query: { archived: true, offset: 0 } }));
});
test("failed refresh keeps cached rows visible and offers retry", async () => {
  render(<HistoryOrganizer language="en-US" onOpen={() => {}} onClose={() => {}} />);
  await screen.findByText("Native task");
  listFails = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Native task")).toBeDefined();
  expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
});

test("large histories navigate bounded pages and reset the page when filters change", async () => {
  // Given: the catalog has more than one thousand results.
  paginated = true;
  render(<HistoryOrganizer language="en-US" onOpen={() => {}} onClose={() => {}} />);
  await screen.findByText("Native task");
  // When: the user moves to the next page and then narrows the source.
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(calls.at(-1)?.args).toMatchObject({ query: { offset: 50, limit: 50 }, refresh: false }));
  fireEvent.change(screen.getByLabelText("Source"), { target: { value: "legacy" } });
  // Then: the narrowed search starts at the first bounded page.
  await waitFor(() => expect(calls.at(-1)?.args).toMatchObject({ query: { source: "legacy", offset: 0, limit: 50 }, refresh: false }));
});

test("a new chat action remains available from the global organizer", async () => {
  // Given: the organizer has an action to start a new conversation.
  const newChat = mock(() => {});
  render(<HistoryOrganizer language="en-US" onOpen={() => {}} onClose={() => {}} onNewChat={newChat} />);
  await screen.findByText("Native task");
  // When: the user starts a new chat.
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  // Then: the chat owner receives exactly one request.
  expect(newChat).toHaveBeenCalledTimes(1);
});

test("an open failure keeps the organizer and conversation visible", async () => {
  // Given: the native conversation is temporarily unavailable.
  render(<HistoryOrganizer language="en-US" onOpen={async () => { throw new Error("history_catalog_unavailable"); }} onClose={() => {}} />);
  await screen.findByText("Native task");
  // When: the user opens the native row.
  fireEvent.click(screen.getByRole("button", { name: "Open Native task" }));
  // Then: a visible error preserves the row for retry.
  expect((await screen.findByRole("alert")).textContent).toContain("Could not open this conversation");
  expect(screen.getByRole("button", { name: "Open Native task" })).toBeDefined();
});

test("confirmed deletion defaults to forgetting conversation-only memories", async () => {
  const deleted = mock(async () => {});
  render(<HistoryOrganizer language="en-US" onOpen={() => {}} onClose={() => {}} onDeleted={deleted} />);
  await screen.findByText("Native task");
  fireEvent.click(screen.getByRole("button", { name: "Actions for Native task" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(true);
  expect(deleted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(deleted).toHaveBeenCalledWith(nativeRow, true));
});

test("unchecking conversation memory cleanup preserves the user's choice", async () => {
  const deleted = mock(async () => {});
  render(<HistoryOrganizer language="en-US" onOpen={() => {}} onClose={() => {}} onDeleted={deleted} />);
  await screen.findByText("Native task");
  fireEvent.click(screen.getByRole("button", { name: "Actions for Native task" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(deleted).toHaveBeenCalledWith(nativeRow, false));
});

test("memory identity ambiguity preserves memories without resurrecting a deleted conversation", async () => {
  render(<HistoryOrganizer language="en-US" onOpen={() => {}} onClose={() => {}}
    onDeleted={async () => { throw { code: "CONFLICT", message: "memory_conversation_identity_ambiguous" }; }} />);
  await screen.findByText("Native task");
  fireEvent.click(screen.getByRole("button", { name: "Actions for Native task" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect((await screen.findByRole("alert")).textContent).toContain("memories were kept");
  expect(screen.queryByRole("button", { name: "Open Native task" })).toBeNull();
});


test.each([
  ["zh-CN", "暂不可用", "工作台会话 · 轻聊天只读"],
  ["en-US", "Unavailable", "Workbench · read only in light chat"],
])("unavailable rows avoid duplicate badges but retain other read-only reasons in %s", async (language, unavailable, workbench) => {
  rows = [{ ...nativeRow, availability: "unavailable", capabilities: { ...nativeRow.capabilities, readOnlyReason: "native_unavailable" } },
    { ...legacyRow, availability: "unavailable", capabilities: { ...legacyRow.capabilities, readOnlyReason: "workbench_owned" } }];
  render(<HistoryOrganizer language={language} onOpen={() => {}} onClose={() => {}} />);
  await screen.findByText("Native task");
  expect(screen.getAllByText(unavailable)).toHaveLength(2);
  expect(screen.getByText(workbench)).toBeDefined();
});

test("opening an unavailable conversation shows a localized retry message without a backend code", async () => {
  const open = mock(async () => { throw new Error("history_catalog_unavailable"); });
  render(<HistoryOrganizer language="zh-CN" onOpen={open} onClose={() => {}} />);
  const row = await screen.findByRole("button", { name: "打开 Native task" });
  fireEvent.click(row);
  const error = await screen.findByRole("alert");
  expect(error.textContent).toContain("打开会话失败，请重试。");
  expect(error.textContent).not.toContain("history_catalog_unavailable");
  expect(screen.getByRole("button", { name: "重试" })).toBeDefined();
  fireEvent.click(row);
  await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
});
