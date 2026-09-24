import type { CatalogPage, UnifiedHistoryRow } from "../lib/unifiedHistory";

export function nativeHistoryFixture(sessionId: string, directory = ".", title = "t"): UnifiedHistoryRow {
  const sidecarId = "managed-local-v1";
  return {
    key: `native:${sidecarId.length}:${sidecarId}${directory.length}:${directory}${sessionId.length}:${sessionId}`,
    identity: { kind: "native", sidecarId, directory, sessionId },
    title, userTitle: null, displayTitle: title, source: "light_chat", created: 1, updated: 2,
    pinned: false, archived: false, availability: "available", ownership: "unowned", runtime: "idle", tombstone: null,
    capabilities: { open: true, openWorkbench: true, send: true, rename: true, pin: true, archive: true, delete: true, readOnlyReason: null },
  };
}

export function historyArgument(args: unknown, field: string): string {
  if (typeof args !== "object" || args === null) throw new Error("history arguments missing");
  const value = Object.fromEntries(Object.entries(args))[field];
  if (typeof value !== "string") throw new Error(`history ${field} missing`);
  return value;
}

export function registeredHistoryFixture(args: unknown): UnifiedHistoryRow {
  const entry = nativeHistoryFixture(historyArgument(args, "sessionId"), historyArgument(args, "directory"));
  return { ...entry, runtime: "unknown", capabilities: { ...entry.capabilities, send: false, delete: false, readOnlyReason: "runtime_unknown" } };
}

export function catalogPageFixture(items: readonly UnifiedHistoryRow[]): CatalogPage {
  return { items, total: items.length, hasMore: false, offline: false, errors: [], directories: [...new Set(items.flatMap(row => row.identity.kind === "native" ? [row.identity.directory] : []))] };
}
