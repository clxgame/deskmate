import { afterEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import * as tauriEvent from "@tauri-apps/api/event";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { dict } from "../lib/i18n";
import { legacySettingsFixture } from "../testing/settingsFixtures";

import { installTimePopoverFixture } from "../testing/timePopoverFixture";
installTimePopoverFixture();

const t = dict("zh-CN");
const settings = legacySettingsFixture({ scheduledTasks: [
  { id: "daily", time: "14:25", prompt: "Take a walking break", enabled: true },
] });
const invoke = mock<(command: string) => Promise<unknown>>((command) => {
  if (command === "get_settings") return Promise.resolve(settings);
  if (command === "app_version") return Promise.resolve("0.2.8");
  return Promise.resolve(undefined);
});
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  ...tauriEvent,
  listen: () => Promise.resolve(() => undefined),
}));
const SettingsApp = (await import("./SettingsApp")).default;

afterEach(cleanup);

async function openWidgets() {
  render(<SettingsApp />);
  await screen.findByRole("checkbox", { name: t.autostart });
  fireEvent.click(screen.getByRole("button", { name: t.tabWidget }));
}

describe("scheduled widget settings", () => {
  test("adds a trimmed task with the selected time when the draft is submitted", async () => {
    // Given an existing task and a filled draft.
    await openWidgets();
    fireEvent.change(screen.getByRole("textbox", { name: t.taskPrompt }), {
      target: { value: "  Read today's notes  " },
    });
    // When the user adds it.
    fireEvent.click(screen.getByRole("button", { name: t.taskAdd }));
    // Then the new task is enabled and only its prompt draft clears.
    expect(screen.getByText("Read today's notes")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: t.taskEnable("09:00") }).getAttribute("checked")).toBe("");
    expect(screen.getByRole("textbox", { name: t.taskPrompt }).getAttribute("value")).toBe("");
  });

  test("keeps a task listed when its enabled switch is turned off", async () => {
    // Given an enabled daily task.
    await openWidgets();
    const toggle = screen.getByRole("checkbox", { name: t.taskEnable("14:25") });
    // When it is disabled.
    fireEvent.click(toggle);
    // Then the task remains while its switch is unchecked.
    expect(toggle instanceof HTMLInputElement && toggle.checked).toBe(false);
    expect(screen.getByText("Take a walking break")).toBeTruthy();
  });

  test("removes the requested task when its delete action is clicked", async () => {
    // Given an existing daily task.
    await openWidgets();
    // When the user deletes it.
    fireEvent.click(screen.getByRole("button", { name: t.taskDelete }));
    // Then it leaves the task list.
    expect(screen.queryByText("Take a walking break")).toBe(null);
  });

  test("changes the common always-on-top setting when its switch is clicked", async () => {
    // Given widget settings with always-on-top disabled.
    await openWidgets();
    const toggle = screen.getByRole("checkbox", { name: t.alwaysOnTop });
    // When the user enables it.
    fireEvent.click(toggle);
    // Then its checked state updates.
    expect(toggle instanceof HTMLInputElement && toggle.checked).toBe(true);
  });
});

describe("widget selection and themed time", () => {
  test("opens a complete time chooser when the time control is activated", async () => {
    await openWidgets();
    fireEvent.click(screen.getByRole("button", { name: t.taskTime }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(84);
  });

  test("labels the main panel through its sidebar without a duplicate heading", async () => {
    await openWidgets();
    expect(screen.getByRole("main", { name: t.tabWidget })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: t.tabWidget })).toBe(null);
  });
});
test("retains the scheduled-task draft when another widget is selected", async () => {
  await openWidgets();
  fireEvent.change(screen.getByRole("textbox", { name: t.taskPrompt }), {
    target: { value: "Finish my notes" },
  });
  fireEvent.click(screen.getByRole("button", { name: t.pomodoroTitle }));
  expect(screen.queryByRole("textbox", { name: t.taskPrompt })).toBe(null);
  fireEvent.click(screen.getByRole("button", { name: t.scheduledTasks }));
  const prompt = screen.getByRole("textbox", { name: t.taskPrompt });
  expect(prompt instanceof HTMLInputElement && prompt.value).toBe("Finish my notes");
  expect(screen.getByRole("button", { name: t.scheduledTasks }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("checkbox", { name: t.alwaysOnTop })).toBeTruthy();
});