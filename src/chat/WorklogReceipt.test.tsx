import * as core from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorklogReceipt, worklogChatCopy } from "./WorklogReceipt";
import { WORKLOG_SYSTEM_INSTRUCTION } from "./worklogActions";
import { worklogLabels } from "../settings/worklog/worklogLabels";
import type { ChatWorklogOperation } from "./useWorklogChat";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve());
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
beforeEach(() => invoke.mockClear());
afterEach(cleanup);
const pending: ChatWorklogOperation = { messageId: "msg-test", requestId: "request", receipt: null, error: null };
const noop = async () => {};

test("pending output never appears as a saved record", () => {
  render(<WorklogReceipt operation={pending} language="zh-CN" onUndo={noop} onRefresh={noop} />);
  expect(screen.getByRole("status").textContent).toContain("尚未确认成功");
  expect(screen.queryByText("已保存到工作日志")).toBeNull();
  expect(screen.getByRole("button", { name: "查询结果" })).toBeTruthy();
});

test("committed entries expose actual date and an immediate undo", () => {
  render(<WorklogReceipt operation={{ ...pending, undoable: true, receipt: { operationId: "request", entityId: "entry", entityKind: "entry", revision: 1, businessDate: "2026-09-08", status: "committed" } }} language="en-US" onUndo={noop} onRefresh={noop} />);
  expect(screen.getByRole("status").textContent).toContain("Work entry saved · 2026-09-08");
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
});

test("a queued report receipt does not claim the report is archived", () => {
  render(<WorklogReceipt operation={{ ...pending, receipt: { operationId: "request", entityId: "run", entityKind: "run", revision: 1, businessDate: null, status: "committed" } }} language="en-US" onUndo={noop} onRefresh={noop} />);
  expect(screen.getByRole("status").textContent).toContain("Report job created");
  expect(screen.queryByText("Report archived")).toBeNull();
});

test("deleted records lose their undo action", () => {
  render(<WorklogReceipt operation={{ ...pending, undoable: true, receipt: { operationId: "request", entityId: "entry", entityKind: "entry", revision: 1, businessDate: null, status: "deleted" } }} language="en-US" onUndo={noop} onRefresh={noop} />);
  expect(screen.getByRole("status").textContent).toContain("Deleted");
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

test("uses the work journal feature name in receipt actions and authorization guidance", () => {
  // Given a committed work entry and its Chinese feature labels.
  const copy = worklogChatCopy("zh-CN");
  const feature = worklogLabels("zh-CN").featureTitle;
  // When the receipt is rendered.
  render(<WorklogReceipt operation={{ ...pending, receipt: { operationId: "request", entityId: "entry", entityKind: "entry", revision: 1, businessDate: null, status: "committed" } }} language="zh-CN" onUndo={noop} onRefresh={noop} />);
  // Then the save guidance names the actual button and the receipt names the selected feature.
  expect(feature).toBe("工作日志");
  expect(`保存到${feature}`).toBe(copy.save);
  expect(WORKLOG_SYSTEM_INSTRUCTION).toContain(copy.save);
  expect(screen.getByRole("button", { name: `查看${feature}` })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(`已保存到${feature}`);
});

for (const state of ["queued", "running", "failed", "succeeded"] as const) test(`opens the matching entity when a ${state} receipt is clicked`, () => {
  // Given a report run receipt at the requested state.
  const run = { id: "run1", scheduleId: null, kind: "weekly", periodStart: "2026-09-07", periodEnd: "2026-09-11", occurrenceKey: "manual", state, attempt: 1, nextRetryAt: null, leaseUntil: null, sessionId: null, baseReportRevision: null, sourceManifest: [], sourceSnapshot: [], modelId: "test", resultReportId: state === "succeeded" ? "report1" : null, errorCode: null, createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z" } as const;
  render(<WorklogReceipt operation={{ ...pending, run, receipt: { operationId: "request", entityId: "run1", entityKind: "run", revision: 1, businessDate: null, status: "committed" } }} language="zh-CN" onUndo={noop} onRefresh={noop} />);
  // When the user opens its receipt.
  fireEvent.click(screen.getByRole("button", { name: "查看工作日志" }));
  // Then the host receives the real run identity, not a fabricated schedule.
  expect(invoke.mock.calls).toEqual([["open_worklog_settings", { target: state === "succeeded" ? { kind: "report", id: "report1" } : { kind: "run", id: "run1" } }]]);
});
