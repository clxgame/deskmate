import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import * as tauriCore from "@tauri-apps/api/core";
import type { HistorySession } from "../lib/history";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>();
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
const { useAgentHistoryView } = await import("./useAgentHistoryView");

const records = new Map<string, HistorySession>();
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
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
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
