import { beforeEach, expect, mock, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve({ fileName: "weekly-2026-09-07.md", exportedAt: "2026-09-08T00:00:00Z" }));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
const { exportReport, copyReport } = await import("./reportExport");
beforeEach(() => invoke.mockClear());
test("returns the committed filename when the host exports the requested version", async () => {
  const receipt = await exportReport("report-1", "version-2", "markdown");
  expect(invoke.mock.calls[0]).toEqual(["worklog_export_report", { request: { reportId: "report-1", versionId: "version-2", format: "markdown" } }]);
  expect(receipt.fileName).toBe("weekly-2026-09-07.md");
});
test("propagates host rejection when Downloads cannot be written", async () => {
  invoke.mockImplementationOnce(() => Promise.reject({ code: "EXPORT_FAILED", message: "write rejected" }));
  expect(exportReport("report-1", "version-2", "text")).rejects.toMatchObject({ code: "EXPORT_FAILED" });
});
test("copies exact Unicode source when clipboard accepts the selected version", async () => {
  const text = "# 周报\n\n完成登录联调\n";
  await copyReport(text);
  expect(await navigator.clipboard.readText()).toBe(text);
});
