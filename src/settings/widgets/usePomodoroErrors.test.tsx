import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { act, cleanup, renderHook } from "@testing-library/react";
import { pausePomodoro, resetPomodoro, startPomodoro, type PomodoroSnapshot } from "../../lib/pomodoro";
import { restoreTauriModuleFixture } from "../../testing/tauriModuleFixture";
import { usePomodoro } from "./usePomodoro";

const initial = {
  phase: "focus", status: "idle", remainingMs: 1_500_000, durationMs: 1_500_000,
  preferences: { focusMinutes: 25, breakMinutes: 5 }, revision: 0,
} as const satisfies PomodoroSnapshot;

beforeEach(restoreTauriModuleFixture);
afterEach(() => { cleanup(); clearMocks(); });

async function mounted() {
  const hook = renderHook(usePomodoro);
  await act(async () => {});
  return hook;
}

async function refreshVisible() {
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}

describe("Pomodoro error recovery", () => {
  test("retains a rejected Start error through successive successful reads", async () => {
    // Given a Start rejection already presented by the hook.
    const failure = new Error("Synthetic Start failure");
    const ipc = mock((command: string) => command === "pomodoro_start" ? Promise.reject(failure) : initial);
    mockIPC(ipc, { shouldMockEvents: true });
    const hook = await mounted();
    await act(async () => hook.result.current.run(() => startPomodoro(initial.preferences)));
    expect(hook.result.current.error).toBe(failure);
    // When the background read path succeeds twice.
    await refreshVisible();
    await refreshVisible();
    // Then the actionable failure remains while reads keep working.
    expect(ipc.mock.calls.map(([command]) => command)).toEqual([
      "pomodoro_get", "pomodoro_start", "pomodoro_get", "pomodoro_get",
    ]);
    expect(hook.result.current.error).toBe(failure);
    expect(hook.result.current.snapshot).toEqual(initial);
  });

  test("updates the native remainder while a Pause failure remains actionable", async () => {
    // Given a rejected Pause on a running timer.
    const failure = new Error("Synthetic Pause failure");
    let current: PomodoroSnapshot = { ...initial, status: "running", remainingMs: 70_000, revision: 1 };
    mockIPC((command) => command === "pomodoro_pause" ? Promise.reject(failure) : current, { shouldMockEvents: true });
    const hook = await mounted();
    await act(async () => hook.result.current.run(pausePomodoro));
    current = { ...current, remainingMs: 65_000 };
    // When a newer native remainder is read.
    await refreshVisible();
    // Then countdown refresh continues and the failed action stays visible.
    expect(hook.result.current.snapshot?.remainingMs).toBe(65_000);
    expect(hook.result.current.error).toBe(failure);
  });

  test("clears a command failure when explicit Retry successfully reloads state", async () => {
    // Given a rejected Start.
    mockIPC((command) => command === "pomodoro_start" ? Promise.reject(new Error("Synthetic failure")) : initial, { shouldMockEvents: true });
    const hook = await mounted();
    await act(async () => hook.result.current.run(() => startPomodoro(initial.preferences)));
    expect(hook.result.current.error).toBeInstanceOf(Error);
    // When the user explicitly retries and the native read succeeds.
    await act(async () => hook.result.current.retry());
    // Then the error clears and the current idle snapshot remains.
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.snapshot).toEqual(initial);
  });

  test("clears a command failure after a subsequent command succeeds", async () => {
    // Given a rejected Start and an available Reset command.
    const reset = { ...initial, revision: 1 };
    mockIPC((command) => {
      if (command === "pomodoro_start") return Promise.reject(new Error("Synthetic failure"));
      return command === "pomodoro_reset" ? reset : initial;
    }, { shouldMockEvents: true });
    const hook = await mounted();
    await act(async () => hook.result.current.run(() => startPomodoro(initial.preferences)));
    expect(hook.result.current.error).toBeInstanceOf(Error);
    // When Reset succeeds.
    await act(async () => hook.result.current.run(resetPomodoro));
    // Then the action failure clears and the command result is accepted.
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.snapshot).toEqual(reset);
  });

  test("automatically clears a read failure when a later read succeeds", async () => {
    // Given one failed native read.
    let available = false;
    mockIPC(() => available ? initial : Promise.reject(new Error("Synthetic read failure")), { shouldMockEvents: true });
    const hook = await mounted();
    expect(hook.result.current.error).toBeInstanceOf(Error);
    available = true;
    // When the normal refresh succeeds.
    await refreshVisible();
    // Then the transient read error clears without requiring Retry.
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.snapshot).toEqual(initial);
  });

  test("retains a command failure when a newer native phase event arrives", async () => {
    // Given a Pause rejection with a continuing native timer.
    const failure = new Error("Synthetic Pause failure");
    mockIPC((command) => command === "pomodoro_pause" ? Promise.reject(failure) : initial, { shouldMockEvents: true });
    const hook = await mounted();
    await act(async () => hook.result.current.run(pausePomodoro));
    const ready = { ...initial, phase: "break", status: "ready", remainingMs: 300_000, durationMs: 300_000, revision: 2 } as const;
    // When native reports the next phase ready.
    await act(async () => emit("deskmate://pomodoro-changed", ready));
    // Then fresh timer state is accepted without dismissing the failed command.
    expect(hook.result.current.snapshot).toEqual(ready);
    expect(hook.result.current.error).toBe(failure);
  });
});
