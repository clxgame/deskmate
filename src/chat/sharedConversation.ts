import { catalogLoad, type CatalogLoadResult, type UnifiedHistoryRow } from "../lib/unifiedHistory";

export type NativeConversationIdentity = {
  readonly kind: "native";
  readonly sidecarId: string;
  readonly directory: string;
  readonly sessionId: string;
};

export type ConversationAccess = {
  readonly key: string;
  readonly identity: NativeConversationIdentity | { readonly kind: "legacy"; readonly historyId: string };
  readonly capabilities: { readonly send: boolean; readonly readOnlyReason: string | null };
};

/** The host's fresh capability decision is only valid for the exact displayed conversation. */
export function validateSharedConversation(
  displayed: ConversationAccess,
  fresh: ConversationAccess,
): NativeConversationIdentity | null {
  const before = displayed.identity;
  const after = fresh.identity;
  if (before.kind !== "native" || after.kind !== "native" || !fresh.capabilities.send) return null;
  if (displayed.key !== fresh.key || before.sidecarId !== after.sidecarId ||
    before.directory !== after.directory || before.sessionId !== after.sessionId) return null;
  return after;
}

export async function loadSharedConversation(row: UnifiedHistoryRow): Promise<CatalogLoadResult> {
  const loaded = await catalogLoad(row.key);
  if (loaded.entry.key !== row.key || JSON.stringify(loaded.entry.identity) !== JSON.stringify(row.identity)) {
    throw new Error("history identity changed");
  }
  return loaded;
}

export function conversationReadOnlyReason(entry: UnifiedHistoryRow, language: string): string {
  const zh = language === "zh-CN";
  if (entry.identity.kind === "legacy") return zh ? "旧版文本记录，仅供阅读" : "Legacy text record · read only";
  if (entry.archived) return zh ? "此对话已归档，恢复后可继续" : "Archived conversation · restore it to continue";
  if (entry.availability !== "available" || entry.runtime === "unknown") return zh ? "暂时无法确认对话状态，仅供阅读" : "Conversation state unavailable · read only";
  if (entry.ownership === "agent") return zh ? "此对话由任务管理，请在工作台查看" : "Managed by a task · open in workbench";
  if (entry.ownership === "workbench" || entry.source === "workbench") return zh ? "此对话由工作台管理，请在工作台继续" : "Managed by workbench · continue there";
  if (entry.runtime === "running") return zh ? "对话仍在运行，请在工作台查看" : "Conversation is running · open in workbench";
  return zh ? "此对话目前仅供阅读" : "This conversation is currently read only";
}
