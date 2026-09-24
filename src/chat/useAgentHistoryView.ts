import { useCallback, useEffect, useRef, useState } from "react";
import { historyLoad, type HistorySession } from "../lib/history";
import type { CatalogLoadResult, UnifiedHistoryRow } from "../lib/unifiedHistory";
import { loadSharedConversation } from "./sharedConversation";

function scopedArchive(loaded: CatalogLoadResult): HistorySession | null {
  if (!loaded.originRunId || !loaded.agentDetails || loaded.entry.identity.kind !== "native") return null;
  return { id: loaded.entry.identity.sessionId, title: loaded.entry.displayTitle,
    created: loaded.entry.created, updated: loaded.entry.updated, messages: loaded.messages,
    originRunId: loaded.originRunId, agentDetails: loaded.agentDetails };
}

export type AgentHistoryOpenResult =
  | { readonly kind: "agent"; readonly session: HistorySession }
  | { readonly kind: "ordinary"; readonly session: HistorySession }
  | { readonly kind: "missing" }
  | { readonly kind: "stale" };

export function useAgentHistoryView(activeSessionId: string | null) {
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [archive, setArchive] = useState<HistorySession | null>(null);
  const viewedRef = useRef<string | null>(null);
  const scopeRef = useRef<UnifiedHistoryRow | null>(null);
  const generationRef = useRef(0);
  const previousActiveRef = useRef<string | null>(activeSessionId);

  const leave = useCallback(() => {
    generationRef.current += 1;
    viewedRef.current = null;
    scopeRef.current = null;
    setViewedId(null);
    setArchive(null);
  }, []);

  const readCurrent = useCallback(async (id: string) => {
    const generation = generationRef.current;
    const scope = scopeRef.current;
    const session = scope ? await loadSharedConversation(scope).then(scopedArchive).catch(() => null)
      : await historyLoad(id).catch(() => null);
    if (
      generation !== generationRef.current ||
      viewedRef.current !== id ||
      !session?.originRunId
    ) return null;
    return session;
  }, []);

  const refresh = useCallback(async (id: string) => {
    const session = await readCurrent(id);
    if (!session) return false;
    setArchive(session);
    return true;
  }, [readCurrent]);

  const open = useCallback(async (id: string): Promise<AgentHistoryOpenResult> => {
    const generation = ++generationRef.current;
    scopeRef.current = null;
    const session = await historyLoad(id).catch(() => null);
    if (generation !== generationRef.current) return { kind: "stale" };
    if (!session) {
      viewedRef.current = null;
      scopeRef.current = null;
      setViewedId(null);
      setArchive(null);
      return { kind: "missing" };
    }
    if (!session.originRunId) {
      viewedRef.current = null;
      scopeRef.current = null;
      setViewedId(null);
      setArchive(null);
      return { kind: "ordinary", session };
    }
    viewedRef.current = session.id;
    setViewedId(session.id);
    setArchive(session);
    return { kind: "agent", session };
  }, []);

  const openScoped = useCallback((loaded: CatalogLoadResult): AgentHistoryOpenResult => {
    generationRef.current += 1;
    const session = scopedArchive(loaded);
    if (!session) return { kind: "missing" };
    scopeRef.current = loaded.entry;
    viewedRef.current = session.id;
    setViewedId(session.id);
    setArchive(session);
    return { kind: "agent", session };
  }, []);

  const adopt = useCallback(async (id: string) => {
    if (viewedRef.current !== id) scopeRef.current = null;
    generationRef.current += 1;
    viewedRef.current = id;
    setViewedId(id);
    setArchive(null);
    await refresh(id);
  }, [refresh]);

  const selectedRunActive = archive?.agentDetails?.status === "active";
  useEffect(() => {
    const previousActive = previousActiveRef.current;
    previousActiveRef.current = activeSessionId;
    if (!viewedId) return;
    const isActive = activeSessionId === viewedId || selectedRunActive;
    const justFinished = previousActive === viewedId && !isActive;
    if (!isActive && !justFinished) return;

    let cancelled = false;
    let loading = false;
    const load = async () => {
      if (cancelled || loading) return;
      loading = true;
      try {
        const session = await readCurrent(viewedId);
        if (!cancelled && session) setArchive(session);
      } finally { loading = false; }
    };
    void load();
    if (!isActive) return () => { cancelled = true; };
    const timer = globalThis.setInterval(() => void load(), 1000);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [activeSessionId, readCurrent, selectedRunActive, viewedId]);

  return { viewedId, archive, open, openScoped, adopt, leave };
}



