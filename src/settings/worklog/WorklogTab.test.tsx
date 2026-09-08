import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entry } from "../../lib/worklog";
const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve([]));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
mock.module("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
const { WorklogTab } = await import("./WorklogTab");
const { dict } = await import("../../lib/i18n");
const entry: Entry = { id: "e1", revision: 3, businessDate: "2026-09-08", project: "YUME", text: "完成登录联调", originalText: "完成登录联调", status: "done", sourceSessionId: null, sourceMessageId: null, createdAt: "2026-09-08T01:00:00Z", updatedAt: "2026-09-08T01:00:00Z" };
beforeEach(() => { invoke.mockClear(); invoke.mockImplementation(() => Promise.resolve([])); });
afterEach(cleanup);
test("shows empty state when no persisted records exist", async () => {
  // Given an empty host repository.
  // When the work records center opens.
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  // Then the user sees an explicit empty state.
  expect(await screen.findByText("这个范围内还没有工作记录。")).toBeTruthy();
});
test("keeps the draft when a concurrent edit rejects its original revision", async () => {
  // Given a record opened at revision three and a newer host revision.
  invoke.mockImplementation((command) => command === "worklog_query" ? Promise.resolve([entry]) : command === "worklog_update" ? Promise.reject({ code: "CONFLICT", message: "revision changed" }) : Promise.resolve([]));
  const user = userEvent.setup();
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  await user.click(await screen.findByRole("button", { name: /完成登录联调/ }));
  const content = screen.getByRole("textbox", { name: "内容" });
  await user.clear(content); await user.type(content, "保留我的修订");
  // When the user saves an outdated revision.
  await user.click(screen.getByRole("button", { name: "保存" }));
  // Then the draft remains visible and the conflict is explicit.
  expect((await screen.findByRole("alert")).textContent).toContain("草稿已保留");
  expect(content instanceof HTMLTextAreaElement && content.value).toBe("保留我的修订");
  expect(invoke.mock.calls.find(([command]) => command === "worklog_update")?.[1]).toMatchObject({ request: { expectedRevision: 3, text: "保留我的修订" } });
});
test("does not delete when confirmation is cancelled", async () => {
  // Given an existing record.
  invoke.mockImplementation((command) => Promise.resolve(command === "worklog_query" ? [entry] : []));
  const user = userEvent.setup(); render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  await user.click(await screen.findByRole("button", { name: /完成登录联调/ }));
  await user.click(screen.getByRole("button", { name: "删除" }));
  // When the user cancels deletion.
  await user.click(screen.getByRole("button", { name: "取消" }));
  // Then no destructive host call is made.
  expect(invoke.mock.calls.some(([command]) => command === "worklog_delete_entry")).toBe(false);
});
test("retries after the repository is unavailable", async () => {
  // Given an unavailable repository.
  invoke.mockImplementation(() => Promise.reject({ code: "STORAGE_UNAVAILABLE", message: "unavailable" }));
  const user = userEvent.setup(); render(<WorklogTab language="en-US" t={dict("en-US")} />);
  await screen.findByRole("alert"); invoke.mockImplementation(() => Promise.resolve([]));
  // When Retry is pressed after recovery.
  await user.click(screen.getByRole("button", { name: "Retry" }));
  // Then the list loads without restarting the app.
  await waitFor(() => expect(screen.getByText("No work records in this range.")).toBeTruthy());
});
test("keeps valid per-entry request IDs when a range deletion partly fails and retries", async () => {
  const user = userEvent.setup();
  let records = [entry, { ...entry, id: "e2", text: "第二条事项" }];
  let failSecond = true;
  invoke.mockImplementation((command, args) => {
    if (command === "worklog_query") return Promise.resolve(records);
    if (command !== "worklog_delete_entry") return Promise.resolve([]);
    if (typeof args !== "object" || args === null || !("request" in args)) return Promise.reject(new Error("invalid request"));
    const request = args.request;
    if (typeof request !== "object" || request === null || !("id" in request) || !("requestId" in request) || typeof request.requestId !== "string" || !/^[0-9a-f-]{36}$/.test(request.requestId)) return Promise.reject(new Error("invalid UUID"));
    if (request.id === "e2" && failSecond) { failSecond = false; return Promise.reject({ code: "STORAGE_UNAVAILABLE", message: "temporary" }); }
    records = records.filter((record) => record.id !== request.id);
    return Promise.resolve({ status: "deleted" });
  });
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  await user.click(await screen.findByRole("button", { name: "删除筛选事项" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByRole("alert");
  expect(records.map((record) => record.id)).toEqual(["e2"]);
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("这个范围内还没有工作记录。");
  const deletes = invoke.mock.calls.filter(([command]) => command === "worklog_delete_entry");
  expect(deletes).toHaveLength(3);
  expect(deletes[1]?.[1]).toEqual(deletes[2]?.[1]);
});
