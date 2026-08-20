import { invoke } from "@tauri-apps/api/core";

/** A single chat message saved to local history. */
export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
  time: number;
}

/** A full chat session record. */
export interface HistorySession {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: HistoryMessage[];
}

/** Lightweight listing entry. */
export interface HistorySummary {
  id: string;
  title: string;
  created: number;
  updated: number;
  count: number;
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
