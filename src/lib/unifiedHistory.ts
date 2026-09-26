import { invoke } from "@tauri-apps/api/core";
import type { AgentHistoryDetails, HistoryMessage } from "./history";

export type CatalogIdentity =
  | { readonly kind: "native"; readonly sidecarId: string; readonly directory: string; readonly sessionId: string }
  | { readonly kind: "legacy"; readonly historyId: string };
export type ConversationSource = "light_chat" | "workbench" | "legacy";
export interface HistoryCapabilities {
  readonly open: boolean;
  readonly openWorkbench: boolean;
  readonly send: boolean;
  readonly rename: boolean;
  readonly pin: boolean;
  readonly archive: boolean;
  readonly delete: boolean;
  readonly readOnlyReason: string | null;
}
export interface UnifiedHistoryRow {
  readonly key: string;
  readonly identity: CatalogIdentity;
  readonly title: string;
  readonly userTitle: string | null;
  readonly displayTitle: string;
  readonly source: ConversationSource;
  readonly created: number;
  readonly updated: number;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly availability: "available" | "stale" | "unavailable";
  readonly ownership: "unowned" | "workbench" | "agent";
  readonly runtime: "idle" | "running" | "unknown";
  readonly tombstone: { readonly requestedAt: number; readonly remoteDeleted: boolean } | null;
  readonly capabilities: HistoryCapabilities;
}
export interface CatalogQuery {
  readonly search?: string;
  readonly source?: ConversationSource;
  readonly directory?: string;
  readonly archived?: boolean;
  readonly pinned?: boolean;
  readonly from?: number;
  readonly to?: number;
  readonly offset?: number;
  readonly limit?: number;
}
export interface CatalogPage {
  readonly items: readonly UnifiedHistoryRow[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly offline: boolean;
  readonly errors: readonly string[];
  readonly directories: readonly string[];
}
export interface CatalogLoadResult {
  readonly entry: UnifiedHistoryRow;
  readonly messages: HistoryMessage[];
  readonly agentDetails?: AgentHistoryDetails;
  readonly originRunId?: string;
}
export interface CatalogPreview {
  readonly key: string;
  readonly status: "ready" | "empty" | "unavailable";
  readonly text: string | null;
  readonly role: "user" | "assistant" | null;
  readonly time: number | null;
  readonly localOnly: boolean;
}
export type CatalogMutation =
  | { readonly action: "rename"; readonly title: string }
  | { readonly action: "pin"; readonly pinned: boolean }
  | { readonly action: "archive"; readonly archived: boolean }
  | { readonly action: "delete"; readonly confirmed: boolean };

export function catalogList(query: CatalogQuery, refresh = false): Promise<CatalogPage> {
  return invoke<CatalogPage>("history_catalog_list", { query, refresh });
}
export function catalogLoad(key: string): Promise<CatalogLoadResult> {
  return invoke<CatalogLoadResult>("history_catalog_load", { key });
}

export function catalogPreviews(keys: readonly string[]): Promise<CatalogPreview[]> {
  return invoke<CatalogPreview[]>("history_catalog_previews", { keys });
}
export function catalogMutate(key: string, mutation: CatalogMutation): Promise<UnifiedHistoryRow | null> {
  return invoke<UnifiedHistoryRow | null>("history_catalog_mutate", { key, mutation });
}

export function saveLocalMessages(key: string, messages: readonly HistoryMessage[]): Promise<void> {
  return invoke<void>("history_save_local_messages", { key, messages });
}

export function historyDateBounds(from: string, to: string): Pick<CatalogQuery, "from" | "to"> {
  const result: { from?: number; to?: number } = {};
  if (from) result.from = new Date(`${from}T00:00:00`).getTime();
  if (to) {
    const nextDay = new Date(`${to}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    result.to = nextDay.getTime() - 1;
  }
  return result;
}


