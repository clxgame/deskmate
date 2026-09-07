import { restoreTauriModuleFixture } from "../../testing/tauriModuleFixture";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { dict } from "../../lib/i18n";
import type { PomodoroSnapshot } from "../../lib/pomodoro";
import { legacySettingsFixture } from "../../testing/settingsFixtures";
import { PomodoroWidget } from "./PomodoroWidget";

const t = dict("en-US");
const initial = {
  phase: "focus", status: "idle", remainingMs: 1_500_000, durationMs: 1_500_000,
  preferences: { focusMinutes: 25, breakMinutes: 5 }, revision: 0,
} as const satisfies PomodoroSnapshot;

beforeEach(restoreTauriModuleFixture);
afterEach(() => { cleanup(); clearMocks(); });

function Harness() {
  const [settings, setSettings] = useState(legacySettingsFixture());
  return <PomodoroWidget settings={settings} t={t}
    patch={(key, value) => setSettings((current) => ({ ...current, [key]: value }))} />;
}

describe("Pomodoro controls", () => {
  test("starts once with the edited duration when clicked twice before completion", async () => {
    // Given a loaded idle timer and a pending native start.
    const pending = Promise.withResolvers<PomodoroSnapshot>();
    const ipc = mock((command: string, _payload?: unknown) =>
      command === "pomodoro_start" ? pending.promise : Promise.resolve(initial));
    mockIPC(ipc, { shouldMockEvents: true });
    render(<Harness />);
    await screen.findByText("25:00");
    fireEvent.change(screen.getByLabelText(t.pomodoroFocusMinutes), { target: { value: "40" } });
    // When the same start control is activated twice synchronously.
    const start = screen.getByRole("button", { name: t.pomodoroStart });
    fireEvent.click(start);
    fireEvent.click(start);
    // Then only the current preference is sent once, and editing is locked.
    expect(ipc.mock.calls.filter(([command]) => command === "pomodoro_start")).toEqual([
      ["pomodoro_start", { preferences: { focusMinutes: 40, breakMinutes: 5 } }],
    ]);
    await act(async () => pending.resolve({ ...initial, status: "running", durationMs: 2_400_000, remainingMs: 2_400_000, revision: 1 }));
    expect(screen.getByText("40:00")).toBeDefined();
    expect(screen.getByRole("button", { name: t.pomodoroPause })).toBeDefined();
    expect(screen.getByLabelText(t.pomodoroFocusMinutes).hasAttribute("disabled")).toBe(true);
  });

  test("blocks invalid duration input without calling native start", async () => {
    // Given a loaded idle timer.
    const ipc = mock(() => Promise.resolve(initial));
    mockIPC(ipc, { shouldMockEvents: true });
    render(<Harness />);
    await screen.findByText("25:00");
    // When a focus duration exceeds its supported limit.
    fireEvent.change(screen.getByLabelText(t.pomodoroFocusMinutes), { target: { value: "181" } });
    fireEvent.click(screen.getByRole("button", { name: t.pomodoroStart }));
    // Then a localized error explains the range and no mutation is sent.
    expect(screen.getByRole("alert").textContent).toBe(t.pomodoroInvalidPreferences);
    expect(ipc).toHaveBeenCalledTimes(1);
  });

  test("resumes a paused phase without resetting its remaining time", async () => {
    // Given a paused native snapshot.
    const paused = { ...initial, status: "paused", remainingMs: 89_000, revision: 2 } as const;
    const ipc = mock((command: string) => Promise.resolve(command === "pomodoro_start"
      ? { ...paused, status: "running", revision: 3 } : paused));
    mockIPC(ipc, { shouldMockEvents: true });
    render(<Harness />);
    await screen.findByText("01:29");
    // When resume is activated.
    fireEvent.click(screen.getByRole("button", { name: t.pomodoroResume }));
    // Then the native remainder survives and the running action appears.
    await screen.findByRole("button", { name: t.pomodoroPause });
    expect(screen.getByText("01:29")).toBeDefined();
  });

  test("shows the completed phase state when reopened after background expiry", async () => {
    // Given the next phase already ready in native state.
    mockIPC(() => ({ ...initial, phase: "break", status: "ready", remainingMs: 300_000, durationMs: 300_000, revision: 4 }), { shouldMockEvents: true });
    // When the widget mounts.
    render(<Harness />);
    // Then completion is visible, waiting for a start.
    await screen.findByText("05:00");
    expect(screen.getByRole("status").textContent).toBe(t.pomodoroReadyBreak);
    expect(screen.getByRole("button", { name: t.pomodoroBreak }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: t.pomodoroStart })).toBeDefined();
  });

  test("pauses from the running action and displays the exact native remainder", async () => {
    // Given a running timer.
    const running = { ...initial, status: "running", remainingMs: 62_000, revision: 1 } as const;
    mockIPC((command) => command === "pomodoro_pause"
      ? { ...running, status: "paused", remainingMs: 61_000, revision: 2 } : running, { shouldMockEvents: true });
    render(<Harness />);
    await screen.findByText("01:02");
    // When pause is activated.
    fireEvent.click(screen.getByRole("button", { name: t.pomodoroPause }));
    // Then the paused remainder and resume control are displayed.
    await screen.findByText("01:01");
    expect(screen.getByRole("button", { name: t.pomodoroResume })).toBeDefined();
    expect(screen.getByLabelText(t.pomodoroBreakMinutes).hasAttribute("disabled")).toBe(true);
  });

  test("resets the current break phase and unlocks its preferences", async () => {
    // Given a paused break phase.
    const paused = { ...initial, phase: "break", status: "paused", remainingMs: 42_000, durationMs: 300_000, revision: 3 } as const;
    mockIPC((command) => command === "pomodoro_reset"
      ? { ...paused, status: "idle", remainingMs: 300_000, revision: 4 } : paused, { shouldMockEvents: true });
    render(<Harness />);
    await screen.findByText("00:42");
    // When reset is activated.
    fireEvent.click(screen.getByRole("button", { name: t.pomodoroReset }));
    // Then the current phase returns to its full idle duration.
    await screen.findByText("05:00");
    expect(screen.getByRole("button", { name: t.pomodoroBreak }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText(t.pomodoroBreakMinutes).hasAttribute("disabled")).toBe(false);
  });

  test("selects a different phase using the edited preferences", async () => {
    // Given an idle timer with a locally edited break duration.
    const ipc = mock((command: string, _payload?: unknown) => command === "pomodoro_select_phase"
      ? { ...initial, phase: "break", remainingMs: 600_000, durationMs: 600_000, revision: 1 } : initial);
    mockIPC(ipc, { shouldMockEvents: true });
    render(<Harness />);
    await screen.findByText("25:00");
    fireEvent.change(screen.getByLabelText(t.pomodoroBreakMinutes), { target: { value: "10" } });
    // When break is selected.
    fireEvent.click(screen.getByRole("button", { name: t.pomodoroBreak }));
    // Then the selected phase and duration are sent together.
    await screen.findByText("10:00");
    expect(ipc).toHaveBeenLastCalledWith("pomodoro_select_phase", {
      phase: "break", preferences: { focusMinutes: 25, breakMinutes: 10 },
    });
  });
  test("recovers from a malformed native payload through retry", async () => {
    // Given an invalid payload returned once by IPC.
    const ipc = mock((): unknown => ({ ...initial, remainingMs: "invalid" }));
    mockIPC(ipc, { shouldMockEvents: true });
    render(<Harness />);
    await screen.findByRole("alert");
    ipc.mockImplementation(() => initial);
    // When retry is activated.
    fireEvent.click(screen.getByRole("button", { name: t.pomodoroRetry }));
    // Then the valid native snapshot is displayed.
    await screen.findByText("25:00");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
