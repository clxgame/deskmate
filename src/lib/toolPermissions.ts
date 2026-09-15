import { invoke } from "@tauri-apps/api/core";

export type PermissionMode = "allow" | "ask" | "deny";
export type ToolPermissions = {
  readonly worklogRead: PermissionMode;
  readonly worklogWrite: PermissionMode;
  readonly web: PermissionMode;
  readonly shell: PermissionMode;
};
export const DEFAULT_TOOL_PERMISSIONS: ToolPermissions = {
  worklogRead: "allow", worklogWrite: "allow", web: "allow", shell: "ask",
};
export type PermissionRequest = {
  readonly id: string;
  readonly sessionID: string;
  readonly permission: string;
  readonly patterns: readonly string[];
  readonly metadata: unknown;
};
export type PermissionReply = "once" | "reject";
export function pendingPermissions(sessionId: string): Promise<readonly PermissionRequest[]> {
  return invoke("tool_permission_pending", { sessionId });
}
export function replyPermission(sessionId: string, requestId: string, reply: PermissionReply): Promise<void> {
  return invoke("tool_permission_reply", { sessionId, requestId, reply });
}
export function cancelPermissions(sessionId: string): Promise<void> {
  return invoke("tool_permission_cancel", { sessionId });
}
export function permissionKey(tool: string): keyof ToolPermissions | null {
  switch (tool) {
    case "worklog_query": return "worklogRead";
    case "worklog_record": case "worklog_update": case "worklog_generate_report": case "worklog_schedule_report": return "worklogWrite";
    case "webfetch": return "web";
    case "bash": case "shell": return "shell";
    default: return null;
  }
}
