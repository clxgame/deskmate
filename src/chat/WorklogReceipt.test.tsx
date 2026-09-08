import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { WorklogReceipt } from "./WorklogReceipt";
import type { ChatWorklogOperation } from "./useWorklogChat";

afterEach(cleanup);
const pending: ChatWorklogOperation = { messageId: "msg-test", requestId: "request", receipt: null, error: null };
const noop = async () => {};

test("pending output never appears as a saved record", () => {
  render(<WorklogReceipt operation={pending} language="zh-CN" onUndo={noop} onRefresh={noop} />);
  expect(screen.getByRole("status").textContent).toContain("尚未确认成功");
  expect(screen.queryByText("已保存工作记录")).toBeNull();
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
