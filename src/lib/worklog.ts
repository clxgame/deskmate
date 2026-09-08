import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const WORKLOG_CHANGED_EVENT = "deskmate://worklog-changed";
export type EntryStatus = "done" | "in_progress" | "blocked" | "planned";
export type ReportKind = "daily" | "weekly" | "custom";
export type RunState = "queued" | "running" | "succeeded" | "no_material" | "retry_wait" | "failed" | "cancelled";
export interface RecordEntry {
  readonly requestId: string; readonly businessDate: string; readonly project: string | null;
  readonly originalText: string; readonly text: string; readonly status: EntryStatus;
  readonly sourceSessionId: string | null; readonly sourceMessageId: string | null;
}
export interface Entry extends Omit<RecordEntry, "requestId"> {
  readonly id: string; readonly revision: number; readonly createdAt: string; readonly updatedAt: string;
}
export interface UpdateEntry {
  readonly requestId: string; readonly id: string; readonly expectedRevision: number;
  readonly businessDate: string; readonly project: string | null; readonly text: string; readonly status: EntryStatus;
}
export interface DateQuery { readonly start: string; readonly end: string; readonly project: string | null }
export interface DeleteRecord {
  readonly requestId: string; readonly id: string; readonly expectedRevision: number; readonly deleteLinkedReports?: boolean;
}
export interface OperationReceipt {
  readonly operationId: string; readonly entityKind: string; readonly entityId: string;
  readonly revision: number; readonly businessDate: string | null; readonly status: "committed" | "deleted";
}
export interface Report {
  readonly id: string; readonly kind: ReportKind; readonly periodStart: string; readonly periodEnd: string;
  readonly currentVersionId: string | null; readonly revision: number; readonly stale: boolean;
  readonly sourceDeleted: boolean; readonly updatedAt: string;
}
export interface SourceRef { readonly kind: string; readonly id: string; readonly revision: number }
export interface SourceSnapshot { readonly entryStatus: EntryStatus | null; readonly source: SourceRef; readonly businessDate: string; readonly project: string | null; readonly text: string }
export interface ReportVersion {
  readonly id: string; readonly reportId: string; readonly version: number; readonly bodyMarkdown: string;
  readonly origin: "generated" | "manual"; readonly sourceRevisionManifest: readonly SourceRef[];
  readonly sourceSnapshot: readonly SourceSnapshot[]; readonly coverageDates: readonly string[];
  readonly generatedAt: string; readonly modelId: string | null;
}
export interface ReportDetail { readonly report: Report; readonly versions: readonly ReportVersion[] }
export interface SaveReport {
  readonly requestId: string; readonly kind: ReportKind; readonly periodStart: string; readonly periodEnd: string;
  readonly expectedRevision: number | null; readonly bodyMarkdown: string;
}
export interface SaveSchedule {
  readonly requestId: string; readonly id: string | null; readonly expectedRevision: number | null;
  readonly kind: ReportKind; readonly weekdaySet: readonly number[]; readonly localTime: string; readonly enabled: boolean;
}
export interface Schedule extends Omit<SaveSchedule, "requestId" | "expectedRevision" | "id"> {
  readonly id: string; readonly revision: number; readonly timezoneMode: "system_local";
  readonly createdAt: string; readonly updatedAt: string; readonly nextDueAt: string | null;
}
export interface GenerateReport {
  readonly requestId: string; readonly kind: ReportKind; readonly periodStart: string; readonly periodEnd: string; readonly modelId: string;
}
export interface Run {
  readonly id: string; readonly scheduleId: string | null; readonly kind: ReportKind;
  readonly periodStart: string; readonly periodEnd: string; readonly occurrenceKey: string;
  readonly state: RunState; readonly attempt: number; readonly nextRetryAt: string | null; readonly leaseUntil: string | null;
  readonly sessionId: string | null; readonly baseReportRevision: number | null; readonly sourceManifest: readonly SourceRef[];
  readonly sourceSnapshot: readonly SourceSnapshot[]; readonly modelId: string; readonly resultReportId: string | null;
  readonly errorCode: string | null; readonly createdAt: string; readonly updatedAt: string;
}
export interface RetryRun { readonly requestId: string; readonly id: string }
export interface ApplyVersion { readonly requestId: string; readonly reportId: string; readonly versionId: string; readonly expectedRevision: number }
export interface WorklogError { readonly code: string; readonly message: string }
export function asWorklogError(error: unknown): WorklogError {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && "message" in error && typeof error.message === "string") return { code: error.code, message: error.message };
  return { code: "STORAGE_UNAVAILABLE", message: "Work journal is unavailable" };
}
export const worklogAvailable = (): Promise<boolean> => invoke("worklog_available");
export const recordEntry = (request: RecordEntry): Promise<OperationReceipt> => invoke("worklog_record", { request });
export const updateEntry = (request: UpdateEntry): Promise<OperationReceipt> => invoke("worklog_update", { request });
export const queryEntries = (query: DateQuery): Promise<readonly Entry[]> => invoke("worklog_query", { query });
export const deleteEntry = (request: DeleteRecord): Promise<OperationReceipt> => invoke("worklog_delete_entry", { request });
export const listReports = (query: DateQuery): Promise<readonly Report[]> => invoke("worklog_list_reports", { query });
export const getReport = (id: string): Promise<ReportDetail> => invoke("worklog_get_report", { id });
export const saveReport = (request: SaveReport): Promise<OperationReceipt> => invoke("worklog_save_report", { request });
export const applyReportVersion = (request: ApplyVersion): Promise<OperationReceipt> => invoke("worklog_apply_version", { request });
export const deleteReport = (request: DeleteRecord): Promise<OperationReceipt> => invoke("worklog_delete_report", { request });
export const listSchedules = (): Promise<readonly Schedule[]> => invoke("worklog_list_schedules");
export const saveSchedule = (request: SaveSchedule): Promise<OperationReceipt> => invoke("worklog_save_schedule", { request });
export const deleteSchedule = (request: DeleteRecord): Promise<OperationReceipt> => invoke("worklog_delete_schedule", { request });
export const generateReport = (request: GenerateReport): Promise<OperationReceipt> => invoke("worklog_generate_report", { request });
export const listRuns = (): Promise<readonly Run[]> => invoke("worklog_list_runs");
export const retryRun = (request: RetryRun): Promise<OperationReceipt> => invoke("worklog_retry_run", { request });
export const getOperation = (requestId: string): Promise<OperationReceipt | null> => invoke("worklog_get_operation", { requestId });
export const onWorklogChanged = (handler: () => void): Promise<UnlistenFn> => listen(WORKLOG_CHANGED_EVENT, handler);
