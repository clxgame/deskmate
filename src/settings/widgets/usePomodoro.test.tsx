import { restoreTauriModuleFixture } from "../../testing/tauriModuleFixture";
import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { act, cleanup, renderHook } from "@testing-library/react";
import { pausePomodoro, resetPomodoro, selectPomodoroPhase, type PomodoroSnapshot } from "../../lib/pomodoro";
import { usePomodoro } from "./usePomodoro";

const initial = {
  phase: "focus", status: "running", remainingMs: 70_000, durationMs: 1_500_000,
  preferences: { focusMinutes: 25, breakMinutes: 5 }, revision: 1,
} as const satisfies PomodoroSnapshot;

beforeEach(restoreTauriModuleFixture);
afterEach(() => { cleanup(); clearMocks(); jest.useRealTimers(); });

async function mounted() {
  const hook = renderHook(usePomodoro);
  await act(async () => {});
  return hook;
}

describe("Pomodoro snapshot lifecycle", () => {
  test("keeps the reset result when an older read resolves afterwards", async () => {
    // Given a running timer with one pending read.
    const pending = Promise.withResolvers<PomodoroSnapshot>();
    let reads = 0;
    const reset = { ...initial, status: "idle", remainingMs: 1_500_000, revision: 2 } as const;
    mockIPC((command) => {
      if (command === "pomodoro_reset") return reset;
      return ++reads === 1 ? initial : pending.promise;
    }, { shouldMockEvents: true });
    const hook = await mounted();
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => hook.result.current.run(resetPomodoro));
    // When the pre-reset read finally returns.
    await act(async () => pending.resolve({ ...initial, remainingMs: 68_000 }));
    // Then it cannot restore the running phase.
    expect(hook.result.current.snapshot).toEqual(reset);
  });

  test("retains a newer completion event when an older pause response arrives", async () => {
    // Given a native pause response delayed behind a completion event.
    const pending = Promise.withResolvers<PomodoroSnapshot>();
    mockIPC((command) => command === "pomodoro_pause" ? pending.promise : initial, { shouldMockEvents: true });
    const hook = await mounted();
    act(() => { void hook.result.current.run(pausePomodoro); });
    const completed = { ...initial, phase: "break", status: "ready", remainingMs: 300_000, durationMs: 300_000, revision: 3 } as const;
    await act(async () => emit("deskmate://pomodoro-changed", completed));
    // When the old command response arrives.
    await act(async () => pending.resolve({ ...initial, status: "paused", revision: 2 }));
    // Then the newer ready state remains authoritative.
    expect(hook.result.current.snapshot).toEqual(completed);
    expect(hook.result.current.busy).toBe(false);
  });

  test("cleans up pending work and reads the current native state after remount", async () => {
    // Given an unmounted widget with a read still pending.
    const pending = Promise.withResolvers<PomodoroSnapshot>();
    let reads = 0;
    const current = { ...initial, remainingMs: 42_000 };
    const ipc = mock(() => ++reads === 1 ? pending.promise : current);
    mockIPC(ipc, { shouldMockEvents: true });
    const previous = renderHook(usePomodoro);
    previous.unmount();
    const reopened = await mounted();
    // When the previous mount's stale result arrives.
    await act(async () => pending.resolve(initial));
    // Then the remounted widget keeps the native remainder and performs no reset.
    expect(reopened.result.current.snapshot?.remainingMs).toBe(42_000);
    expect(ipc).toHaveBeenCalledTimes(2);
  });

  test("reads a new native remainder when the document becomes visible", async () => {
    // Given the widget showing the last visible snapshot.
    let current: PomodoroSnapshot = initial;
    mockIPC(() => current, { shouldMockEvents: true });
    const hook = await mounted();
    current = { ...initial, remainingMs: 21_000 };
    // When the view becomes visible after native background progress.
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    // Then it displays native elapsed time immediately.
    expect(hook.result.current.snapshot?.remainingMs).toBe(21_000);
  });

  test("shows event errors without replacing the last valid snapshot", async () => {
    // Given a valid running snapshot.
    mockIPC(() => initial, { shouldMockEvents: true });
    const hook = await mounted();
    // When a malformed event crosses the IPC boundary.
    await act(async () => emit("deskmate://pomodoro-changed", { ...initial, phase: "unknown" }));
    // Then a recoverable error is exposed while valid state remains intact.
    expect(hook.result.current.error).toBeInstanceOf(Error);
    expect(hook.result.current.snapshot).toEqual(initial);
  });

  test("serializes commands while a phase selection is pending", async () => {
    // Given a pending phase change.
    const pending = Promise.withResolvers<PomodoroSnapshot>();
    const ipc = mock((command: string) => command === "pomodoro_get" ? initial : pending.promise);
    mockIPC(ipc, { shouldMockEvents: true });
    const hook = await mounted();
    // When phase selection and reset are requested synchronously.
    act(() => {
      void hook.result.current.run(() => selectPomodoroPhase("break", initial.preferences));
      void hook.result.current.run(resetPomodoro);
    });
    // Then only the first command is sent until it settles.
    expect(ipc.mock.calls.map(([command]) => command)).toEqual(["pomodoro_get", "pomodoro_select_phase"]);
    await act(async () => pending.resolve({ ...initial, phase: "break", status: "idle", durationMs: 300_000, remainingMs: 300_000, revision: 2 }));
    expect(hook.result.current.busy).toBe(false);
  });
});
