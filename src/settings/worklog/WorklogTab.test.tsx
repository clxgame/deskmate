import { afterEach, beforeEach, expect, mock, setSystemTime, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entry } from "../../lib/worklog";
import { measureWeekWheel } from "../../testing/weekWheelGeometry";
const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve([]));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
mock.module("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
const { WorklogTab } = await import("./WorklogTab");
const { dict } = await import("../../lib/i18n");
const entry: Entry = { id: "e1", revision: 3, businessDate: "2026-09-08", project: "YUME", text: "完成登录联调", originalText: "完成登录联调", status: "done", sourceSessionId: null, sourceMessageId: null, createdAt: "2026-09-08T01:00:00Z", updatedAt: "2026-09-08T01:00:00Z" };
beforeEach(() => { setSystemTime(new Date("2026-09-12T12:00:00+08:00")); invoke.mockClear(); invoke.mockImplementation(() => Promise.resolve([])); });
afterEach(() => { cleanup(); setSystemTime(); });
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
  await user.click(await screen.findByRole("button", { name: "删除筛选任务" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByRole("alert");
  expect(records.map((record) => record.id)).toEqual(["e2"]);
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("这个范围内还没有工作记录。");
  const deletes = invoke.mock.calls.filter(([command]) => command === "worklog_delete_entry");
  expect(deletes).toHaveLength(3);
  expect(deletes[1]?.[1]).toEqual(deletes[2]?.[1]);
});

test("opens daily reports with tasks below and only two primary views", async () => {
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  await screen.findByText("这个范围内还没有工作记录。");
  const navigation = screen.getByRole("group", { name: "工作日志" });
  expect(within(navigation).getAllByRole("button").map((button) => button.textContent)).toEqual(["日报", "周报"]);
  expect(screen.getByRole("button", { name: "日报" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByLabelText("日期").getAttribute("value")).toBe("2026-09-12");
  expect(screen.getByRole("region", { name: "任务" }).compareDocumentPosition(screen.getByText("这个时间段内还没有报告。")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
});

test("defaults weekly queries to Monday through Sunday and highlights the current week", async () => {
  const user = userEvent.setup();
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  await user.click(screen.getByRole("button", { name: "周报" }));
  await waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === "worklog_query").at(-1)?.[1]).toEqual({ query: { start: "2026-09-07", end: "2026-09-13", project: null } }));
  expect(invoke.mock.calls.filter(([command]) => command === "worklog_list_reports").at(-1)?.[1]).toEqual({ query: { start: "2026-09-07", end: "2026-09-13", project: null } });
  const summary = screen.getByText("2026 · 第37周（9.7-9.13）");
  expect(summary.closest("details")?.open).toBe(false);
  await user.click(summary);
  expect(screen.getByRole("option", { name: "第36周（8.31-9.6）" }).getAttribute("data-period")).toBe("past");
  expect(screen.getByRole("option", { name: "第37周（9.7-9.13） 本周" }).getAttribute("aria-current")).toBe("date");
  expect(screen.getByRole("option", { name: "第38周（9.14-9.20）" }).getAttribute("data-period")).toBe("future");
});

test("changes both task and report queries when selecting a past or future week", async () => {
  const user = userEvent.setup();
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  await user.click(screen.getByRole("button", { name: "周报" }));
  const summary = document.querySelector(".worklog-week-picker summary");
  if (!(summary instanceof HTMLElement)) throw new Error("Missing week picker");
  await user.click(summary);
  measureWeekWheel(screen.getByRole("listbox"));
  for (const [name, start, end] of [["第36周（8.31-9.6）", "2026-08-31", "2026-09-06"], ["第38周（9.14-9.20）", "2026-09-14", "2026-09-20"]]) {
    await user.click(screen.getByRole("option", { name }));
    fireEvent(screen.getByRole("listbox"), new Event("scrollend"));
    await waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === "worklog_query").at(-1)?.[1]).toEqual({ query: { start, end, project: null } }));
    expect(invoke.mock.calls.filter(([command]) => command === "worklog_list_reports").at(-1)?.[1]).toEqual({ query: { start, end, project: null } });
    expect(summary.closest("details")?.open).toBe(true);
  }
});

test("only queries the final week after continuous scrolling and does not query again on reopening", async () => {
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  fireEvent.click(screen.getByRole("button", { name: "周报" }));
  await screen.findByText("这个范围内还没有工作记录。");
  const summary = screen.getByText("2026 · 第37周（9.7-9.13）");
  fireEvent.click(summary);
  const list = measureWeekWheel(screen.getByRole("listbox"));
  const queries = () => invoke.mock.calls.filter(([command]) => command === "worklog_query");
  const reports = () => invoke.mock.calls.filter(([command]) => command === "worklog_list_reports");
  const before = [queries().length, reports().length];
  for (const index of [35, 37, 38]) {
    fireEvent.wheel(list); list.scrollTop = index * 36; fireEvent.scroll(list);
  }
  expect([queries().length, reports().length]).toEqual(before);
  fireEvent(list, new Event("scrollend"));
  await waitFor(() => expect(queries().length).toBe((before[0] ?? 0) + 1));
  expect(reports().length).toBe((before[1] ?? 0) + 1);
  expect(queries().at(-1)?.[1]).toEqual({ query: { start: "2026-09-21", end: "2026-09-27", project: null } });
  expect(reports().at(-1)?.[1]).toEqual(queries().at(-1)?.[1]);
  fireEvent.click(summary); fireEvent.click(summary);
  expect([queries().length, reports().length]).toEqual(before.map((count) => count + 1));
});

test("clears old tasks when another day's query fails", async () => {
  invoke.mockImplementation((command) => Promise.resolve(command === "worklog_query" ? [entry] : []));
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  await screen.findByRole("button", { name: /完成登录联调/ });
  invoke.mockImplementation(() => Promise.reject({ code: "STORAGE_UNAVAILABLE", message: "unavailable" }));
  fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-09-11" } });
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: /完成登录联调/ })).toBeNull();
  expect(screen.queryByText("这个范围内还没有工作记录。")).toBeNull();
});

test("a failed week query hides old records and retries the selected week", async () => {
  invoke.mockImplementation((command) => Promise.resolve(command === "worklog_query" ? [entry] : []));
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  fireEvent.click(screen.getByRole("button", { name: "周报" }));
  await screen.findByRole("button", { name: /完成登录联调/ });
  fireEvent.click(screen.getByText("2026 · 第37周（9.7-9.13）"));
  measureWeekWheel(screen.getByRole("listbox"));
  invoke.mockImplementation(() => Promise.reject({ code: "STORAGE_UNAVAILABLE", message: "unavailable" }));
  fireEvent.click(screen.getByRole("option", { name: "第36周（8.31-9.6）" }));
  fireEvent(screen.getByRole("listbox"), new Event("scrollend"));
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: /完成登录联调/ })).toBeNull();
  expect(screen.queryByText("这个范围内还没有工作记录。")).toBeNull();
  invoke.mockImplementation(() => Promise.resolve([]));
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("这个范围内还没有工作记录。");
  expect(invoke.mock.calls.filter(([command]) => command === "worklog_query").at(-1)?.[1]).toEqual({ query: { start: "2026-08-31", end: "2026-09-06", project: null } });
});

test("a slow older week query cannot replace the latest week's tasks", async () => {
  let resolveOlder: (entries: readonly Entry[]) => void = () => {};
  const older = new Promise<readonly Entry[]>((resolve) => { resolveOlder = resolve; });
  const future = { ...entry, id: "future", text: "新周独特任务", businessDate: "2026-09-15" };
  invoke.mockImplementation((command, args) => {
    if (command !== "worklog_query") return Promise.resolve([]);
    if (typeof args !== "object" || args === null || !("query" in args) || typeof args.query !== "object" || args.query === null || !("start" in args.query)) return Promise.resolve([]);
    if (args.query.start === "2026-08-31") return older;
    return Promise.resolve(args.query.start === "2026-09-14" ? [future] : [entry]);
  });
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  fireEvent.click(screen.getByRole("button", { name: "周报" }));
  await screen.findByRole("button", { name: /完成登录联调/ });
  fireEvent.click(screen.getByText("2026 · 第37周（9.7-9.13）"));
  measureWeekWheel(screen.getByRole("listbox"));
  fireEvent.click(screen.getByRole("option", { name: "第36周（8.31-9.6）" }));
  fireEvent(screen.getByRole("listbox"), new Event("scrollend"));
  fireEvent.click(screen.getByRole("option", { name: "第38周（9.14-9.20）" }));
  fireEvent(screen.getByRole("listbox"), new Event("scrollend"));
  await screen.findByRole("button", { name: /新周独特任务/ });
  resolveOlder([{ ...entry, id: "older", text: "旧周独特任务", businessDate: "2026-09-06" }]);
  await waitFor(() => expect(screen.queryByRole("button", { name: /旧周独特任务/ })).toBeNull());
  expect(screen.getByRole("button", { name: /新周独特任务/ })).toBeTruthy();
});

test("new tasks in the current week default to today's business date rather than Sunday", async () => {
  const user = userEvent.setup();
  render(<WorklogTab language="zh-CN" t={dict("zh-CN")} />);
  await user.click(screen.getByRole("button", { name: "周报" }));
  await user.click(screen.getByRole("button", { name: "添加任务" }));
  expect(screen.getByLabelText("日期").getAttribute("value")).toBe("2026-09-12");
});
