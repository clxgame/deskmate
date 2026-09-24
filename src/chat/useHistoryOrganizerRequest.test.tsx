import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
let callback: (() => void) | undefined;
let finishListen: ((stop: () => void) => void) | undefined;
let pending = true;
const calls: string[] = [];
const stop = mock(() => undefined);
mock.module("@tauri-apps/api/event", () => ({
  listen: (event: string, onEvent: () => void) => {
    calls.push(event);
    callback = onEvent;
    return new Promise<() => void>((resolve) => { finishListen = resolve; });
  },
}));
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    calls.push(command);
    const value = pending;
    pending = false;
    return value;
  },
}));
const { useHistoryOrganizerRequest } = await import("./useHistoryOrganizerRequest");
afterEach(async () => { cleanup(); await Promise.resolve(); calls.length = 0; pending = true; callback = undefined; finishListen = undefined; stop.mockClear(); });

test("a request made before mount opens only after its listener is installed", async () => {
  const open = mock(() => undefined);
  renderHook(() => useHistoryOrganizerRequest(open));
  expect(calls).toEqual(["history://open"]);
  await act(async () => { finishListen?.(stop); });
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  expect(calls).toEqual(["history://open", "consume_history_organizer_request"]);
  await act(async () => { callback?.(); });
  expect(open).toHaveBeenCalledTimes(1);
});

test("an unmounted deferred listener cannot consume a later pending request", async () => {
  const open = mock(() => undefined);
  const hook = renderHook(() => useHistoryOrganizerRequest(open));
  hook.unmount();
  await act(async () => { callback?.(); finishListen?.(stop); });
  expect(calls).toEqual(["history://open"]);
  expect(pending).toBe(true);
  expect(open).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledTimes(1);
});

