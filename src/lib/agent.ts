import { invoke } from "@tauri-apps/api/core";
import type { PermissionReply, PermissionRequest } from "./toolPermissions";

export type AgentOutcome = "completed" | "failed" | "cancelled" | "interrupted";
export type AgentRun = {
  readonly runId: string;
  readonly sessionId: string | null;
  readonly workspacePath: string;
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly outcome: AgentOutcome | null;
  readonly errorSummary: string | null;
  readonly messageIds: readonly string[];
  readonly partIds: readonly string[];
  readonly callIds: readonly string[];
};
export type AgentArtifact = { readonly reference: string; readonly runId: string; readonly kind: "file" | "command"; readonly label: string; readonly path: string | null; readonly command: string | null; readonly result: string | null; readonly verified: boolean };
export type AgentProjection = { readonly active: AgentRun | null; readonly recent: readonly AgentRun[]; readonly artifacts: readonly AgentArtifact[] };

export class AgentWireError extends Error {
  readonly name = "AgentWireError";
  constructor(readonly code: "record" | "text" | "strings" | "outcome" | "recent" | "permissions") { super(`agent_wire:${code}`); }
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AgentWireError("record");
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new AgentWireError("text");
  return value;
}
function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new AgentWireError("strings");
  return value;
}
function parseRun(value: unknown): AgentRun {
  const item = record(value);
  const outcome = item.outcome;
  if (outcome !== null && outcome !== "completed" && outcome !== "failed" && outcome !== "cancelled" && outcome !== "interrupted") throw new AgentWireError("outcome");
  return { runId: text(item.runId), sessionId: optionalText(item.sessionId), workspacePath: text(item.workspacePath), createdAt: text(item.createdAt), endedAt: optionalText(item.endedAt), outcome, errorSummary: optionalText(item.errorSummary), messageIds: strings(item.messageIds), partIds: strings(item.partIds), callIds: strings(item.callIds) };
}
function parseArtifact(value: unknown): AgentArtifact {
  const item = record(value);
  if (item.kind !== "file" && item.kind !== "command") throw new AgentWireError("record");
  if (typeof item.verified !== "boolean") throw new AgentWireError("record");
  return { reference: text(item.reference), runId: text(item.runId), kind: item.kind, label: text(item.label), path: optionalText(item.path), command: optionalText(item.command), result: optionalText(item.result), verified: item.verified };
}
export async function readAgentRuns(): Promise<AgentProjection> {
  const value = record(await invoke("agent_run_read"));
  if (!Array.isArray(value.recent)) throw new AgentWireError("recent");
  if (!Array.isArray(value.artifacts)) throw new AgentWireError("recent");
  return { active: value.active === null ? null : parseRun(value.active), recent: value.recent.map(parseRun), artifacts: value.artifacts.map(parseArtifact) };
}
export async function startAgentRun(workspacePath: string, input: string): Promise<AgentRun> {
  return parseRun(await invoke("agent_run_start", { request: { workspacePath, input } }));
}
export function cancelAgentRun(runId: string): Promise<void> { return invoke("agent_run_cancel", { runId }); }
export async function pendingAgentPermissions(run: AgentRun): Promise<readonly PermissionRequest[]> {
  const value: unknown = await invoke("agent_permission_pending", { runId: run.runId });
  if (!Array.isArray(value)) throw new AgentWireError("permissions");
  return value.map((entry) => {
    const item = record(entry);
    const patterns = strings(item.patterns);
    return { id: text(item.requestId), sessionID: run.sessionId ?? "", permission: text(item.permission), patterns, metadata: { native: item.metadata, command: item.command, cwd: item.cwd } };
  });
}
export function replyAgentPermission(runId: string, requestId: string, reply: PermissionReply): Promise<void> {
  return invoke("agent_permission_reply", { runId, requestId, reply });
}
export function locateAgentArtifact(runId: string, reference: string): Promise<void> { return invoke("agent_artifact_locate", { runId, reference }); }
