import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as core from "@tauri-apps/api/core";
import * as events from "@tauri-apps/api/event";
const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve(null));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
mock.module("@tauri-apps/api/event", () => ({ ...events, listen: () => Promise.resolve(() => {}) }));
const { useWorklogChat } = await import("./useWorklogChat");

beforeEach(() => { invoke.mockReset(); });
afterEach(cleanup);

test("an old-session save completes without publishing a receipt into the new chat", async () => {
  let finishSave: (value: unknown) => void = () => {};
  const saveResponse = new Promise<unknown>((resolve) => { finishSave = resolve; });
  let operationLookups = 0;
  invoke.mockImplementation(async (command) => {
    if (command === "worklog_record") return saveResponse;
    if (command === "worklog_get_operation") operationLookups += 1;
    return null;
  });
  const hook = renderHook(({ session }: { readonly session: string }) => useWorklogChat(session), { initialProps: { session: "old-session" } });
  let saving = Promise.resolve();
  await act(async () => { saving = hook.result.current.save("old-message", "Synthetic old-session entry"); });
  expect(hook.result.current.operations.length).toBe(1);
  hook.rerender({ session: "new-session" });
  await act(async () => { finishSave({ status: "committed" }); await saving; });
  expect(hook.result.current.operations).toEqual([]);
  expect(operationLookups).toBe(0);
});

test("an old-session rejected schedule does not attach an error to the new chat", async () => {
  let rejectSchedule: (error: unknown) => void = () => {};
  const response = new Promise<unknown>((_, reject) => { rejectSchedule = reject; });
  invoke.mockImplementation(async (command) => command === "worklog_save_schedule" ? response : null);
  const hook = renderHook(({ session }: { readonly session: string }) => useWorklogChat(session), { initialProps: { session: "old-session" } });
  let saving = Promise.resolve();
  await act(async () => { saving = hook.result.current.schedule("old-message"); });
  hook.rerender({ session: "new-session" });
  await act(async () => { rejectSchedule({ code: "CONFLICT", message: "Changed" }); await saving; });
  expect(hook.result.current.operations).toEqual([]);
});
