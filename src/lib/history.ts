import { invoke } from "@tauri-apps/api/core";

/** A single chat message saved to local history. */
export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
  time: number;
  messageId?: string;
  partId?: string;
}

/** A full chat session record. */
export interface HistorySession {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: HistoryMessage[];
  originRunId?: string;
  deleted?: boolean;
  agentDetails?: AgentHistoryDetails;
}

export interface AgentHistoryDetails {
  workspacePath: string;
  status: "active" | "completed" | "failed" | "cancelled" | "interrupted";
  source: "interactive" | "scheduled";
  availability: "ready" | "retryable" | "missing" | "workspace_missing";
}

/** Lightweight listing entry. */
export interface HistorySummary {
  id: string;
  title: string;
  created: number;
  updated: number;
  count: number;
  agentDetails?: AgentHistoryDetails;
}

export function historyList(): Promise<HistorySummary[]> {
  return invoke<HistorySummary[]>("history_list");
}

export function historyLoad(id: string): Promise<HistorySession | null> {
  return invoke<HistorySession | null>("history_load", { id });
}

export function historySave(session: HistorySession): Promise<void> {
  return invoke<void>("history_save", { session });
}

export function historyDelete(id: string): Promise<void> {
  return invoke<void>("history_delete", { id });
}
