import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import * as tauriCore from "@tauri-apps/api/core";
import type { HistorySession } from "../lib/history";
import type { CatalogLoadResult } from "../lib/unifiedHistory";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>();
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
const { useAgentHistoryView } = await import("./useAgentHistoryView");

const records = new Map<string, HistorySession>();
let catalogLoader: ((key: string) => Promise<CatalogLoadResult>) | null = null;
let loadOverride: ((id: string) => Promise<HistorySession | null>) | null = null;

function record(id: string, text: string, originRunId = "run_origin"): HistorySession {
  return {
    id,
    title: id,
    created: 1,
    updated: 2,
    originRunId,
    messages: [{ role: "assistant", text, time: 2 }],
  };
}

beforeEach(() => {
  records.clear();
  loadOverride = null;
  catalogLoader = null;
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === "history_catalog_load" && args && typeof args === "object" && "key" in args && typeof args.key === "string" && catalogLoader) return catalogLoader(args.key);
    if (command !== "history_load") throw new Error(`unexpected command: ${command}`);
    const id = (args as { id: string }).id;
    return loadOverride ? loadOverride(id) : records.get(id) ?? null;
  });
});

afterEach(cleanup);

test("loads the final Agent archive once when the viewed run stops", async () => {
  records.set("ses_agent", record("ses_agent", "working"));
  const hook = renderHook(
    ({ active }: { readonly active: string | null }) => useAgentHistoryView(active),
    { initialProps: { active: "ses_agent" } as { readonly active: string | null } },
  );
  await act(async () => { await hook.result.current.open("ses_agent"); });
  await waitFor(() => expect(hook.result.current.archive?.messages[0]?.text).toBe("working"));
  records.set("ses_agent", record("ses_agent", "final answer"));
  const loadsBeforeFinish = invoke.mock.calls.length;
  hook.rerender({ active: null });
  await waitFor(() => expect(hook.result.current.archive?.messages[0]?.text).toBe("final answer"));
  expect(invoke.mock.calls.slice(loadsBeforeFinish)).toEqual([
    ["history_load", { id: "ses_agent" }],
  ]);
});

test("a late archive response cannot replace the newly opened Agent view", async () => {
  let releaseOld: ((value: HistorySession) => void) | null = null;
  records.set("new", record("new", "new answer"));
  loadOverride = (id) => id === "old"
    ? new Promise((resolve) => { releaseOld = resolve; })
    : Promise.resolve(records.get(id) ?? null);
  const hook = renderHook(() => useAgentHistoryView(null));
  let oldOpen = Promise.resolve<unknown>(null);
  await act(async () => { oldOpen = hook.result.current.open("old"); });
  await act(async () => { await hook.result.current.open("new"); });
  await waitFor(() => expect(hook.result.current.archive?.id).toBe("new"));
  await act(async () => {
    releaseOld?.(record("old", "old answer"));
    await oldOpen;
  });
  expect(hook.result.current.archive?.id).toBe("new");
});

test("ordinary history leaves Agent ownership and never calls a host write", async () => {
  records.set("ordinary", record("ordinary", "ordinary answer", ""));
  const hook = renderHook(() => useAgentHistoryView(null));
  let kind = "";
  await act(async () => { kind = (await hook.result.current.open("ordinary")).kind; });
  expect(kind).toBe("ordinary");
  expect(hook.result.current.viewedId).toBeNull();
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["history_load"]);
});

function scopedRecord(directory: string, text: string): CatalogLoadResult {
  return {
    entry: { key: `native:test:${directory}:ses_agent`, identity: { kind: "native", sidecarId: "test", directory, sessionId: "ses_agent" },
      title: "Agent history", userTitle: null, displayTitle: "Agent history", source: "light_chat", created: 1, updated: 2,
      pinned: false, archived: false, availability: "available", ownership: "agent", runtime: "idle", tombstone: null,
      capabilities: { open: true, openWorkbench: true, send: false, rename: true, pin: true, archive: true, delete: true, readOnlyReason: "agent_owned" } },
    messages: [{ role: "assistant", text, time: 2 }], originRunId: "run_origin",
    agentDetails: { workspacePath: directory, status: "completed", source: "interactive", availability: "ready" },
  };
}

test("native Agent recovery opens supplied scoped messages and refreshes only by catalog key", async () => {
  const initial = scopedRecord("C:/project-a", "scoped initial");
  catalogLoader = async key => {
    expect(key).toBe(initial.entry.key);
    return scopedRecord("C:/project-a", "scoped latest");
  };
  const hook = renderHook(() => useAgentHistoryView(null));
  act(() => { hook.result.current.openScoped(initial); });
  expect(hook.result.current.archive?.messages[0]?.text).toBe("scoped initial");
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current.adopt("ses_agent"); });
  expect(hook.result.current.archive?.messages[0]?.text).toBe("scoped latest");
  expect(invoke.mock.calls).toEqual([["history_catalog_load", { key: initial.entry.key }]]);
});

test("late native Agent refresh cannot replace another directory with the same bare session ID", async () => {
  const first = scopedRecord("C:/project-a", "first");
  const second = scopedRecord("C:/project-b", "second");
  let release: ((loaded: CatalogLoadResult) => void) | null = null;
  catalogLoader = async key => {
    expect(key).toBe(first.entry.key);
    return new Promise(resolve => { release = resolve; });
  };
  const hook = renderHook(() => useAgentHistoryView("ses_agent"));
  await act(async () => { hook.result.current.openScoped(first); });
  expect(invoke.mock.calls).toEqual([["history_catalog_load", { key: first.entry.key }]]);
  act(() => { hook.result.current.openScoped(second); });
  await act(async () => { release?.(scopedRecord("C:/project-a", "late first")); });
  expect(hook.result.current.archive?.messages[0]?.text).toBe("second");
  expect(hook.result.current.archive?.agentDetails?.workspacePath).toBe("C:/project-b");
});

test("selected host-active Agent history completes while the local Agent projection stays idle", async () => {
  const initial = scopedRecord("C:/external-project", "working snapshot");
  const activeInitial: CatalogLoadResult = { ...initial, agentDetails: { workspacePath: "C:/external-project", status: "active", source: "scheduled", availability: "ready" } };
  catalogLoader = async key => {
    expect(key).toBe(initial.entry.key);
    return scopedRecord("C:/external-project", "external final answer");
  };
  const hook = renderHook(() => useAgentHistoryView(null));
  await act(async () => { hook.result.current.openScoped(activeInitial); });
  expect(hook.result.current.archive?.messages[0]?.text).toBe("external final answer");
  expect(hook.result.current.archive?.agentDetails?.status).toBe("completed");
  expect(invoke.mock.calls).toEqual([["history_catalog_load", { key: initial.entry.key }]]);
});


test.each(["completed", "unmounted"])("serializes selected active history polling and stops when %s", async ending => {
  const initial: CatalogLoadResult = { ...scopedRecord("C:/external-project", "working"),
    agentDetails: { workspacePath: "C:/external-project", status: "active", source: "scheduled", availability: "ready" } };
  let release: ((value: CatalogLoadResult) => void) | undefined;
  catalogLoader = () => new Promise(resolve => { release = resolve; });
  const timer = spyOn(globalThis, "setInterval");
  const clearTimer = spyOn(globalThis, "clearInterval");
  const hook = renderHook(() => useAgentHistoryView(null));
  try {
    await act(async () => { hook.result.current.openScoped(initial); });
    const pollIndex = timer.mock.calls.findIndex(([, delay]) => delay === 1000);
    const tick = timer.mock.calls[pollIndex]?.[0];
    expect(typeof tick).toBe("function");
    if (typeof tick !== "function") return;
    await act(async () => { tick(); tick(); });
    expect(invoke).toHaveBeenCalledTimes(1);
    if (ending === "unmounted") hook.unmount();
    await act(async () => { release?.(scopedRecord("C:/external-project", "final")); });
    expect(clearTimer).toHaveBeenCalledWith(timer.mock.results[pollIndex]?.value);
    await act(async () => { tick(); });
    expect(invoke).toHaveBeenCalledTimes(1);
    if (ending === "completed") {
      expect(hook.result.current.archive?.agentDetails?.status).toBe("completed");
      expect(hook.result.current.archive?.messages[0]?.text).toBe("final");
    }
  } finally {
    hook.unmount();
    timer.mockRestore();
    clearTimer.mockRestore();
  }
});
