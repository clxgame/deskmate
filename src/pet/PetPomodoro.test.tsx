import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PetPomodoro } from "./PetPomodoro";
import { PomodoroWidget } from "../settings/widgets/PomodoroWidget";
import { legacySettingsFixture } from "../testing/settingsFixtures";
import { dict } from "../lib/i18n";
import { POMODORO_CHANGED_EVENT, type PomodoroSnapshot } from "../lib/pomodoro";

const initial = { phase: "focus", status: "idle", remainingMs: 1_500_000,
  durationMs: 1_500_000, preferences: { focusMinutes: 25, breakMinutes: 5 }, revision: 0,
} as const satisfies PomodoroSnapshot;
beforeEach(restoreTauriModuleFixture);
afterEach(() => { cleanup(); clearMocks(); });

test("synchronizes widget start and pet pause/resume through the shared service", async () => {
  // Given two mounted surfaces connected to the same timer and event channel.
  let state: PomodoroSnapshot = initial;
  mockIPC(async (command) => {
    if (command === "pomodoro_start" || command === "pomodoro_pause" || command === "pomodoro_reset") {
      state = { ...state, status: command === "pomodoro_start" ? "running" : command === "pomodoro_pause" ? "paused" : "idle", revision: state.revision + 1 };
      await emit(POMODORO_CHANGED_EVENT, state);
    }
    return state;
  }, { shouldMockEvents: true });
  const pet = render(<PetPomodoro language="en-US" />);
  const widget = render(<PomodoroWidget settings={legacySettingsFixture()} patch={() => {}} t={dict("en-US")} />);
  await screen.findByText("25:00");
  expect(pet.container.querySelector('[role="timer"]')).toBeNull();
  // When starting in the widget, then pausing and resuming on the pet.
  fireEvent.click(within(widget.container).getByRole("button", { name: "Start" }));
  const pause = await within(pet.container).findByRole("button", { name: "Pause" });
  expect(pause.textContent).toBe("");
  fireEvent.click(pause);
  await within(widget.container).findByRole("button", { name: "Resume" });
  fireEvent.click(within(pet.container).getByRole("button", { name: "Resume" }));
  await within(widget.container).findByRole("button", { name: "Pause" });
  // Then both surfaces show the same SVG digits and reset hides the pet display.
  expect(pet.container.querySelector("text")?.textContent).toBe(widget.container.querySelector("text")?.textContent);
  fireEvent.click(within(widget.container).getByRole("button", { name: "Reset" }));
  await act(async () => {});
  expect(pet.container.querySelector('[role="timer"]')).toBeNull();
});

test("retains the next phase control after a completion event", async () => {
  // Given a running timer on the pet.
  mockIPC(() => ({ ...initial, status: "running" }), { shouldMockEvents: true });
  render(<PetPomodoro language="en-US" />);
  await screen.findByRole("button", { name: "Pause" });
  // When the native timer completes into a ready break.
  await act(async () => emit(POMODORO_CHANGED_EVENT, { ...initial, phase: "break", status: "ready", remainingMs: 300_000, durationMs: 300_000, revision: 1 }));
  // Then the break time and icon-only Start remain available.
  expect(screen.getByText("05:00")).toBeDefined();
  expect(screen.getByRole("button", { name: "Start" }).textContent).toBe("");
});
