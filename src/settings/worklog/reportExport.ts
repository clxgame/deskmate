import { invoke } from "@tauri-apps/api/core";
export interface ReportExportReceipt { readonly fileName: string; readonly exportedAt: string }
export function exportReport(reportId: string, versionId: string, format: "markdown" | "text"): Promise<ReportExportReceipt> {
  return invoke("worklog_export_report", { request: { reportId, versionId, format } });
}
export async function copyReport(bodyMarkdown: string): Promise<void> { await navigator.clipboard.writeText(bodyMarkdown); }
