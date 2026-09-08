import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { dict } from "../../lib/i18n";
import type { Run, Schedule } from "../../lib/worklog";
import { worklogLabels } from "./worklogLabels";
const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve({ status: "committed" }));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
const { ReportSchedulePanel } = await import("./ReportSchedulePanel");
const schedule: Schedule = { id: "s1", revision: 4, kind: "weekly", weekdaySet: [2], localTime: "09:30", enabled: true, timezoneMode: "system_local", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", nextDueAt: "2026-09-15T01:30:00Z" };
function open(schedules: readonly Schedule[] = [], runs: readonly Run[] = []) { render(<ReportSchedulePanel schedules={schedules} runs={runs} targetId={null} labels={worklogLabels("en-US")} t={dict("en-US")} onChanged={() => {}} />); }
beforeEach(() => invoke.mockClear());
afterEach(cleanup);
test("uses workdays at18 when a new schedule switches to daily", async () => {
  open(); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Add schedule" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Schedules" }), "daily");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(invoke.mock.calls[0]?.[1]).toMatchObject({ request: { kind: "daily", weekdaySet: [1, 2, 3, 4, 5], localTime: "18:00" } });
});
test("preserves configured days and time when an existing schedule changes kind", async () => {
  open([schedule]); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Schedules" }), "daily");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(invoke.mock.calls[0]?.[1]).toMatchObject({ request: { kind: "daily", weekdaySet: [2], localTime: "09:30", expectedRevision: 4 } });
});
test("displays an explicit time zone offset when a schedule has a next run", () => {
  open([schedule]);
  expect(screen.getByText(/Next run:/).textContent).toMatch(/GMT(?:[+-]\d{2}:\d{2})?/);
});
test("selects one working day when a weekly schedule changes weekday", async () => {
  open(); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Add schedule" }));
  await user.click(screen.getByLabelText("Monday"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(invoke.mock.calls[0]?.[1]).toMatchObject({ request: { weekdaySet: [1] } });
  expect(screen.queryByLabelText("Saturday")).toBeNull();
});
const run: Run = { id: "run1", scheduleId: null, kind: "weekly", periodStart: "2026-09-07", periodEnd: "2026-09-11", occurrenceKey: "manual", state: "no_material", attempt: 1, nextRetryAt: null, leaseUntil: null, sessionId: null, baseReportRevision: null, sourceManifest: [], sourceSnapshot: [], modelId: "test", resultReportId: null, errorCode: null, createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" };
test("offers retry when a run had no material", async () => {
  open([], [run]); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(invoke.mock.calls[0]).toEqual(["worklog_retry_run", { request: { requestId: expect.any(String), id: run.id } }]);
});
test("does not offer manual retry while automatic retry is waiting", () => {
  open([], [{ ...run, state: "retry_wait" }]);
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});
