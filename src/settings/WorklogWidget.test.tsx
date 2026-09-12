import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as events from "@tauri-apps/api/event";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { dict } from "../lib/i18n";
import { legacySettingsFixture } from "../testing/settingsFixtures";
import type { Entry, ReportDetail, Schedule, Run } from "../lib/worklog";
const entry: Entry = { id: "entry-widget", revision: 1, businessDate: "2026-09-09", project: "YUME", text: "已完成联调", originalText: "已完成联调", status: "done", sourceSessionId: null, sourceMessageId: null, createdAt: "2026-09-09T01:00:00Z", updatedAt: "2026-09-09T01:00:00Z" };
const run: Run = { id: "run1", scheduleId: null, kind: "weekly", periodStart: "2026-09-07", periodEnd: "2026-09-11", occurrenceKey: "manual", state: "running", attempt: 1, nextRetryAt: null, leaseUntil: null, sessionId: null, baseReportRevision: null, sourceManifest: [], sourceSnapshot: [], modelId: "test", resultReportId: null, errorCode: null, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
const listeners = new Map<string, (event: { readonly payload: unknown }) => void>();
const report: ReportDetail = { report: { id: "r1", revision: 1, kind: "weekly", periodStart: "2026-09-07", periodEnd: "2026-09-11", currentVersionId: "v1", stale: false, sourceDeleted: false, updatedAt: entry.updatedAt }, versions: [{ id: "v1", reportId: "r1", version: 1, bodyMarkdown: "归档周报", origin: "manual", sourceRevisionManifest: [], sourceSnapshot: [], coverageDates: [], generatedAt: entry.createdAt, modelId: null }] };
const schedule: Schedule = { id: "s1", revision: 1, kind: "weekly", weekdaySet: [5], localTime: "17:00", enabled: true, timezoneMode: "system_local", createdAt: entry.createdAt, updatedAt: entry.updatedAt, nextDueAt: null };
function hostInvoke(command: string): Promise<unknown> {
  switch (command) {
    case "get_pet_visibility_error": return Promise.resolve(null);
    case "get_settings": return Promise.resolve(legacySettingsFixture());
    case "app_version": return Promise.resolve("0.3.2");
    case "worklog_get_report": return Promise.resolve(report);
    case "worklog_list_runs": return Promise.resolve([run]);
    case "worklog_list_schedules": return Promise.resolve([schedule]);
    case "worklog_query": return Promise.resolve([entry]);
    case "pomodoro_get": return Promise.resolve({ phase: "focus", status: "idle", remainingMs: 1500000, durationMs: 1500000, preferences: { focusMinutes: 25, breakMinutes: 5 }, revision: 0 });
    default: return Promise.resolve([]);
  }
}
const invoke = mock(hostInvoke);
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
mock.module("@tauri-apps/api/event", () => ({ ...events, listen: (name: string, callback: (event: { readonly payload: unknown }) => void) => { listeners.set(name, callback); return Promise.resolve(() => listeners.delete(name)); } }));
const SettingsApp = (await import("./SettingsApp")).default;
const t = dict("zh-CN");
beforeEach(() => { listeners.clear(); invoke.mockClear(); invoke.mockImplementation(hostInvoke); });
afterEach(cleanup);
async function openWidgets() { render(<SettingsApp />); await screen.findByRole("checkbox", { name: t.autostart }); fireEvent.click(screen.getByRole("button", { name: t.tabWidget })); }
async function emit(name: string, payload: unknown) { await act(async () => { listeners.get(`deskmate://${name}`)?.({ payload }); }); }
async function openLog() { fireEvent.click(screen.getByRole("button", { name: "工作日志" })); await screen.findByRole("button", { name: /已完成联调/ }); }

test("shows work journal as a lazy peer widget without a separate sidebar", async () => {
  // Given the settings widget selector.
  await openWidgets();
  expect(invoke.mock.calls.some(([command]) => command === "worklog_query")).toBe(false);
  // When the work journal is selected.
  await openLog();
  // Then report views and secondary schedule settings belong to its peer panel.
  expect(within(screen.getByRole("navigation")).queryByRole("button", { name: /工作(日志|记录)/ })).toBeNull();
  expect(within(screen.getByRole("group", { name: t.widgetSelector })).getAllByRole("button")).toHaveLength(3);
  for (const name of ["日报", "周报", "报告定时设置"]) expect(screen.getByRole("button", { name })).toBeTruthy();
});
test("retains the entry draft and filters while another peer is selected", async () => {
  // Given a project filter and an unsaved entry.
  await openWidgets(); await openLog();
  fireEvent.change(screen.getByRole("textbox", { name: "项目" }), { target: { value: "YUME" } });
  fireEvent.click(screen.getByRole("button", { name: "添加任务" }));
  fireEvent.change(screen.getByRole("textbox", { name: "内容" }), { target: { value: "不要丢失的草稿" } });
  // When the user visits Pomodoro and returns.
  fireEvent.click(screen.getByRole("button", { name: t.pomodoroTitle }));
  expect(screen.queryByRole("textbox", { name: "内容" })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "工作日志" })); });
  // Then the draft and filter survive.
  const content = screen.getByRole("textbox", { name: "内容" });
  expect(content instanceof HTMLTextAreaElement && content.value).toBe("不要丢失的草稿");
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  const project = screen.getByRole("textbox", { name: "项目" });
  expect(project instanceof HTMLInputElement && project.value).toBe("YUME");
});
test("reopens repeated entry links and clears their detail for a generic request", async () => {
  // Given an entry link opened and then dismissed.
  await openWidgets(); const target = { kind: "entry", id: entry.id };
  await emit("worklog-target", target); await screen.findByRole("textbox", { name: "内容" });
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  // When that same target arrives again.
  await emit("worklog-target", target);
  // Then it reopens, and a null request removes the obsolete detail.
  expect(await screen.findByRole("textbox", { name: "内容" })).toBeTruthy();
  await emit("worklog-target", null);
  expect(screen.queryByRole("textbox", { name: "内容" })).toBeNull();
  expect(screen.getByRole("button", { name: "添加任务" })).toBeTruthy();
});
test("routes the legacy generic event into the work journal peer", async () => {
  // Given another selected widget.
  await openWidgets();
  // When an existing caller requests the legacy worklog tab.
  await emit("settings-tab", "worklog");
  // Then the widgets sidebar and work journal tile are selected.
  expect(screen.getByRole("main", { name: t.tabWidget })).toBeTruthy();
  expect(screen.getByRole("button", { name: "工作日志" }).getAttribute("aria-pressed")).toBe("true");
});

test("does not replay a consumed entry link after returning from another peer", async () => {
  // Given an opened receipt followed by a new unsaved entry.
  await openWidgets(); await emit("worklog-target", { kind: "entry", id: entry.id });
  await screen.findByRole("textbox", { name: "内容" });
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  fireEvent.click(screen.getByRole("button", { name: "添加任务" }));
  fireEvent.change(screen.getByRole("textbox", { name: "内容" }), { target: { value: "新草稿" } });
  // When the user returns from a different peer.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: t.scheduledTasks })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "工作日志" })); });
  // Then the consumed receipt does not replace the new draft.
  const content = screen.getByRole("textbox", { name: "内容" });
  expect(content instanceof HTMLTextAreaElement && content.value).toBe("新草稿");
});

test("clears old detail and reports a missing schedule target", async () => {
  // Given an existing entry detail.
  await openWidgets(); await emit("worklog-target", { kind: "entry", id: entry.id });
  await screen.findByRole("textbox", { name: "内容" });
  // When a deleted schedule is requested.
  await emit("worklog-target", { kind: "schedule", id: "missing" });
  // Then the stale entry is gone and the failed lookup is explicit.
  expect(screen.queryByRole("textbox", { name: "内容" })).toBeNull();
  expect(await screen.findByRole("alert")).toBeTruthy();
});

test("opens a report from another peer and retries its actual lookup after failure", async () => {
  // Given a temporarily unavailable report lookup.
  await openWidgets();
  let available = false;
  invoke.mockImplementation((command) => command === "worklog_get_report" && !available ? Promise.reject(new Error("offline")) : hostInvoke(command));
  await emit("worklog-target", { kind: "report", id: "r1" });
  await screen.findByRole("alert"); available = true;
  // When the user retries after host recovery.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试" })); });
  // Then the archived report opens through a second lookup.
  const content = await screen.findByRole("textbox", { name: "内容" });
  expect(content instanceof HTMLTextAreaElement && content.value).toBe("归档周报");
  expect(invoke.mock.calls.filter(([command]) => command === "worklog_get_report")).toHaveLength(2);
});

test("reopens a repeated schedule link but does not replay it on later section selection", async () => {
  // Given a schedule receipt whose editor was dismissed.
  await openWidgets(); const target = { kind: "schedule", id: "s1" };
  await emit("worklog-target", target); await screen.findByRole("combobox", { name: "报告定时设置" });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  // When the same receipt is opened again.
  await emit("worklog-target", target);
  // Then its editor opens again, while later manual section navigation clears the target.
  expect(await screen.findByRole("combobox", { name: "报告定时设置" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "日报" }));
  fireEvent.click(screen.getByRole("button", { name: "报告定时设置" }));
  expect(screen.queryByRole("combobox", { name: "报告定时设置" })).toBeNull();
});

test("buffers a work journal target received before settings finishes loading", async () => {
  // Given a settings window still waiting for its host settings.
  const deferred = Promise.withResolvers<ReturnType<typeof legacySettingsFixture>>();
  invoke.mockImplementation((command) => command === "get_settings" ? deferred.promise : hostInvoke(command));
  render(<SettingsApp />);
  // When the target arrives before settings.
  await emit("worklog-target", { kind: "entry", id: entry.id });
  await act(async () => { deferred.resolve(legacySettingsFixture()); });
  // Then the first mounted workspace opens the requested entry.
  expect(await screen.findByRole("textbox", { name: "内容" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "工作日志" }).getAttribute("aria-pressed")).toBe("true");
});

test("cancels an obsolete report response when a generic request follows it", async () => {
  // Given a slow report target lookup.
  await openWidgets(); const deferred = Promise.withResolvers<ReportDetail>();
  invoke.mockImplementation((command) => command === "worklog_get_report" ? deferred.promise : hostInvoke(command));
  await emit("worklog-target", { kind: "report", id: "r1" });
  // When a generic opening replaces that request before the response arrives.
  await emit("worklog-target", null);
  await act(async () => { deferred.resolve(report); });
  // Then the late response cannot reopen the report.
  expect(screen.queryByRole("textbox", { name: "内容" })).toBeNull();
  expect(screen.getByRole("button", { name: "添加任务" })).toBeTruthy();
});

test("activates the work journal peer with the keyboard", async () => {
  // Given keyboard focus on the work journal tile.
  await openWidgets(); const user = userEvent.setup();
  screen.getByRole("button", { name: "工作日志" }).focus();
  // When Enter activates the native button.
  await user.keyboard("{Enter}");
  // Then the full workspace is available and the tile remains selected.
  expect(await screen.findByRole("button", { name: "添加任务" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "工作日志" }).getAttribute("aria-pressed")).toBe("true");
});

test("does not treat a hidden cancelled target lookup as consumed", async () => {
  // Given a report request hidden before the host responds.
  await openWidgets(); const deferred = Promise.withResolvers<ReportDetail>();
  invoke.mockImplementation((command) => command === "worklog_get_report" ? deferred.promise : hostInvoke(command));
  await emit("worklog-target", { kind: "report", id: "r1" });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: t.scheduledTasks })); });
  await act(async () => { deferred.resolve(report); });
  // When the work journal becomes visible again.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "工作日志" })); });
  // Then the interrupted target resolves on return instead of being silently lost.
  const content = await screen.findByRole("textbox", { name: "内容" });
  expect(content instanceof HTMLTextAreaElement && content.value).toBe("归档周报");
  expect(invoke.mock.calls.filter(([command]) => command === "worklog_get_report")).toHaveLength(2);
});

test("keeps an entry target when the category event arrives after it", async () => {
  // Given a target delivered before its category event.
  await openWidgets(); await emit("worklog-target", { kind: "entry", id: entry.id });
  await screen.findByRole("textbox", { name: "内容" });
  // When the category event arrives second.
  await emit("settings-tab", "worklog");
  // Then it selects the workspace without replacing the requested detail.
  expect(screen.getByRole("textbox", { name: "内容" })).toBeTruthy();
});

test("opens a real run target in recent runs without treating it as a schedule", async () => {
  // Given a manual report run without a schedule.
  await openWidgets();
  // When its receipt target is delivered.
  await emit("worklog-target", { kind: "run", id: run.id });
  // Then recent runs shows the running report without a missing schedule error.
  expect(await screen.findByRole("heading", { name: "最近运行" })).toBeTruthy();
  expect(screen.getByText(/2026-09-07 — 2026-09-11 · 运行中/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("safely opens recent runs when an older run is outside the host list", async () => {
  // Given a receipt older than the host recent-run window.
  await openWidgets();
  // When its unchanged run identity is requested.
  await emit("worklog-target", { kind: "run", id: "older-run" });
  // Then recent runs stays available without claiming that the older run is missing.
  expect(await screen.findByRole("heading", { name: "最近运行" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
