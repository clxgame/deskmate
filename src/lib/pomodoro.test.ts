import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import { getPomodoro, startPomodoro, DEFAULT_POMODORO_PREFERENCES } from "./pomodoro";

beforeEach(restoreTauriModuleFixture);
afterEach(() => clearMocks());

test("rejects malformed native countdown values when reading a snapshot", async () => {
  // Given: an invalid native boundary payload.
  mockIPC(() => ({
    phase: "focus", status: "idle", remainingMs: NaN, durationMs: 1500000,
    preferences: DEFAULT_POMODORO_PREFERENCES, revision: 0,
  }));
  // When: a caller reads the timer.
  const result = getPomodoro();
  // Then: invalid data cannot reach rendering.
  await expect(result).rejects.toBeInstanceOf(Error);
});

test("passes current edited preferences when starting before settings debounce", async () => {
  // Given: preferences that differ from persisted defaults.
  const preferences = { focusMinutes: 30, breakMinutes: 8 };
  const snapshot = {
    phase: "focus", status: "running", remainingMs: 1800000, durationMs: 1800000,
    preferences, revision: 1,
  } as const;
  const ipc = mock(() => snapshot);
  mockIPC(ipc);
  // When: starting with the current edit.
  const result = await startPomodoro(preferences);
  // Then: native receives that edit and returns its authoritative snapshot.
  expect(ipc).toHaveBeenCalledWith("pomodoro_start", { preferences });
  expect(result).toEqual(snapshot);
});