import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReportDetail } from "../../lib/worklog";
import { worklogLabels } from "./worklogLabels";
const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve({ fileName: "weekly.md", exportedAt: "2026-09-08T00:00:00Z" }));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
const { ReportEditor, missingReportDates } = await import("./ReportEditor");
const detail: ReportDetail = {
  report: { id: "r1", revision: 7, kind: "weekly", periodStart: "2026-09-07", periodEnd: "2026-09-13", currentVersionId: "v1", stale: true, sourceDeleted: false, updatedAt: "2026-09-08T00:00:00Z" },
  versions: [
    { id: "v2", reportId: "r1", version: 2, bodyMarkdown: "# 候选\n人工核对", origin: "generated", sourceRevisionManifest: [], sourceSnapshot: [], coverageDates: ["2026-09-07"], generatedAt: "2026-09-08T00:00:00Z", modelId: null },
    { id: "v1", reportId: "r1", version: 1, bodyMarkdown: "# 已采用\n保留的人工内容", origin: "manual", sourceRevisionManifest: [], sourceSnapshot: [], coverageDates: ["2026-09-07"], generatedAt: "2026-09-07T00:00:00Z", modelId: null },
  ],
};
function open() { render(<ReportEditor detail={detail} kind="weekly" start="2026-09-07" end="2026-09-13" labels={worklogLabels("zh-CN")} onBack={() => {}} onChanged={() => {}} onReload={() => {}} />); }
beforeEach(() => { invoke.mockClear(); });
afterEach(cleanup);
test("exports the selected candidate when the version chooser changes", async () => {
  open(); const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "版本" }), "v2");
  await user.click(screen.getByRole("button", { name: "导出 Markdown" }));
  expect(invoke.mock.calls[0]?.[1]).toEqual({ request: { reportId: "r1", versionId: "v2", format: "markdown" } });
  expect(await screen.findByText("已保存到下载文件夹： weekly.md")).toBeTruthy();
});
test("does not report success when the selected version export is rejected", async () => {
  invoke.mockImplementationOnce(() => Promise.reject({ code: "EXPORT_FAILED", message: "denied" }));
  open(); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "导出 Markdown" }));
  expect((await screen.findByRole("alert")).textContent).toContain("操作失败");
  expect(screen.queryByText(/已保存到下载文件夹/)).toBeNull();
});
test("disables archived export when the editor has unsaved changes", async () => {
  open(); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "编辑" })); await user.type(screen.getByRole("textbox", { name: "内容" }), "补充");
  expect(screen.getByRole("button", { name: "导出 Markdown" }).hasAttribute("disabled")).toBe(true);
});

test("renders the current report as Markdown and follows the selected candidate", async () => {
  open(); const user = userEvent.setup();
  expect(screen.getByRole("heading", { name: "已采用" })).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox", { name: "版本" }), "v2");
  expect(screen.getByRole("heading", { name: "候选" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "已采用" })).toBeNull();
});

test("previews edited Markdown without changing the original saved source", async () => {
  open(); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "编辑" }));
  const source = "# 本周完成\n\n- **登录联调**\n\n| 任务 | 状态 |\n| --- | --- |\n| 接口验收 | 完成 |\n\n> 等待确认\n\n```ts\nconst done = true;\n```";
  await user.clear(screen.getByRole("textbox", { name: "内容" }));
  await user.paste(source);
  await user.click(screen.getByRole("button", { name: "预览" }));
  const preview = screen.getByRole("region", { name: "内容 · 预览" });
  expect(within(preview).getByRole("heading", { name: "本周完成" })).toBeTruthy();
  expect(within(preview).getByRole("table")).toBeTruthy();
  expect(preview.querySelector("strong")?.textContent).toBe("登录联调");
  expect(preview.querySelector("blockquote")?.textContent).toContain("等待确认");
  expect(preview.querySelector("pre code")?.textContent).toContain("const done = true;");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(invoke.mock.calls[0]?.[1]).toMatchObject({ request: { bodyMarkdown: source } });
});
test("applies a candidate with the opened report revision when explicitly selected", async () => {
  open(); const user = userEvent.setup(); await user.selectOptions(screen.getByRole("combobox", { name: "版本" }), "v2");
  await user.click(screen.getByRole("button", { name: "采用此版本" }));
  expect(invoke.mock.calls[0]?.[1]).toMatchObject({ request: { reportId: "r1", versionId: "v2", expectedRevision: 7 } });
});
test("lists uncovered weekdays when coverage skips material", () => {
  expect(missingReportDates("2026-09-07", "2026-09-13", ["2026-09-07", "2026-09-09"])).toEqual(["2026-09-08", "2026-09-10", "2026-09-11"]);
});
