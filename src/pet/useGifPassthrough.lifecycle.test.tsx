import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useGifPassthrough, createCursorWriter } from "./useGifPassthrough";
import { originalTauriWindow } from "../testing/tauriModuleFixture";

const position = { x: 500, y: 500 };
const origin = mock(async () => ({ x: 0, y: 0 }));
const ratio = mock(async () => 1);
const writes: boolean[] = [];
let finishWrite: (() => void) | undefined;
let finishCursor: ((value: typeof position) => void) | undefined;
let pendingCursor = false;
const cursor = () => pendingCursor ? new Promise<typeof position>((resolve) => { finishCursor = resolve; }) : Promise.resolve(position);
beforeEach(() => {
  writes.length = 0; finishWrite = undefined; finishCursor = undefined; pendingCursor = false; origin.mockClear(); ratio.mockClear();
  mock.module("@tauri-apps/api/window", () => ({ ...originalTauriWindow, cursorPosition: cursor, getCurrentWindow: () => ({ outerPosition: origin, scaleFactor: ratio, setIgnoreCursorEvents: (value: boolean) => { writes.push(value); return new Promise<void>((resolve) => { finishWrite = resolve; }); } }) }));
});
afterEach(() => { cleanup(); finishWrite?.(); mock.module("@tauri-apps/api/window", () => originalTauriWindow); });

test("a lock invalidates pending cursor lookup before later native reads", async () => {
  pendingCursor = true;
  const root = { current: document.createElement("div") };
  const hook = renderHook(() => useGifPassthrough(true, root));
  act(() => hook.result.current(true));
  await act(async () => { finishCursor?.(position); });
  expect(origin).toHaveBeenCalledTimes(0);
  expect(writes).toEqual([]);
});
test("disable during an in-flight true write restores false after that write completes", async () => {
  const root = { current: document.createElement("div") };
  const hook = renderHook(({ enabled }) => useGifPassthrough(enabled, root), { initialProps: { enabled: true } });
  await act(async () => {});
  expect(writes).toEqual([true]);
  hook.rerender({ enabled: false });
  await act(async () => { finishWrite?.(); });
  expect(writes).toEqual([true, false]);
});
test("unmount during an in-flight true write restores false after completion", async () => {
  const root = { current: document.createElement("div") };
  const hook = renderHook(() => useGifPassthrough(true, root));
  await act(async () => {});
  hook.unmount();
  await act(async () => { finishWrite?.(); });
  expect(writes).toEqual([true, false]);
});
test("a failed native write can be retried by a later poll", async () => {
  const calls: boolean[] = [];
  const setIgnored = createCursorWriter(async (value) => { calls.push(value); if (calls.length === 1) throw new Error("temporary unavailable"); });
  setIgnored(true);
  await Promise.resolve(); await Promise.resolve();
  setIgnored(true);
  await Promise.resolve();
  expect(calls).toEqual([true,true]);
});
