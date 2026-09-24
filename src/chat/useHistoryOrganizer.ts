import { useCallback, useEffect, useRef, useState } from "react";
import { asMemoryError } from "../lib/memory";
import { listen } from "@tauri-apps/api/event";
import { catalogList, catalogMutate } from "../lib/unifiedHistory";
import type { CatalogMutation, CatalogPage, CatalogQuery, UnifiedHistoryRow } from "../lib/unifiedHistory";
import type { HistoryCopy } from "./historyOrganizerCopy";
import { useNativeHistoryEvents } from "./useNativeHistoryEvents";

export function useHistoryOrganizer(query: CatalogQuery, copy: HistoryCopy, onDeleted?: (row: UnifiedHistoryRow, forgetMemories: boolean) => Promise<void>, onChanged?: (key: string) => Promise<void>) {
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const requestId = useRef(0);
  const firstLoad = useRef(true);
  const queryRef = useRef(query);
  queryRef.current = query;
  const refresh = useCallback(async (native: boolean) => {
    const request = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await catalogList(queryRef.current, native);
      if (request === requestId.current) setPage(result);
    } catch (cause) {
      if (request === requestId.current) setError(cause instanceof Error ? `${copy.loadFailed} ${cause.message}` : copy.loadFailed);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [copy]);
  useNativeHistoryEvents(refresh);
  useEffect(() => {
    void refresh(firstLoad.current);
    firstLoad.current = false;
    return () => { requestId.current += 1; };
  }, [query, refresh]);
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void listen("history-catalog-changed", () => { void refresh(false); }).then(stop => {
      if (disposed) stop(); else unsubscribe = stop;
    }).catch(cause => {
      if (!disposed) setError(cause instanceof Error ? cause.message : copy.loadFailed);
    });
    return () => { disposed = true; unsubscribe?.(); };
  }, [refresh, copy]);
  const mutate = async (row: UnifiedHistoryRow, mutation: CatalogMutation, forgetMemories = true): Promise<boolean> => {
    setBusyKey(row.key);
    setError("");
    try {
      await catalogMutate(row.key, mutation);
      let cleanupError = "";
      if (mutation.action === "delete") {
        try { await onDeleted?.(row, forgetMemories); }
        catch (cause) {
          cleanupError = asMemoryError(cause).message === "memory_conversation_identity_ambiguous" ? copy.memoryAmbiguous : copy.memoryCleanupFailed;
          console.warn("conversation cleanup failed", cause instanceof Error ? cause.message : String(cause));
        }
      }
      await refresh(false);
      if (cleanupError) setError(cleanupError);
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.includes("history_agent_running") ? copy.activeError : `${copy.failed} ${message}`);
      return false;
    } finally {
      await onChanged?.(row.key);
      setBusyKey(null);
    }
  };
  return { page, loading, error, busyKey, refresh, mutate, setError };
}







