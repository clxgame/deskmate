import { useCallback, useEffect, useRef, useState } from "react";
import { historyLoad, type HistorySession } from "../lib/history";

export type AgentHistoryOpenResult =
  | { readonly kind: "agent"; readonly session: HistorySession }
  | { readonly kind: "ordinary"; readonly session: HistorySession }
  | { readonly kind: "missing" }
  | { readonly kind: "stale" };

export function useAgentHistoryView(activeSessionId: string | null) {
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [archive, setArchive] = useState<HistorySession | null>(null);
  const viewedRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const previousActiveRef = useRef<string | null>(activeSessionId);

  const leave = useCallback(() => {
    generationRef.current += 1;
    viewedRef.current = null;
    setViewedId(null);
    setArchive(null);
  }, []);

  const readCurrent = useCallback(async (id: string) => {
    const generation = generationRef.current;
    const session = await historyLoad(id).catch(() => null);
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
    const session = await historyLoad(id).catch(() => null);
    if (generation !== generationRef.current) return { kind: "stale" };
    if (!session) {
      viewedRef.current = null;
      setViewedId(null);
      setArchive(null);
      return { kind: "missing" };
    }
    if (!session.originRunId) {
      viewedRef.current = null;
      setViewedId(null);
      setArchive(null);
      return { kind: "ordinary", session };
    }
    viewedRef.current = session.id;
    setViewedId(session.id);
    setArchive(session);
    return { kind: "agent", session };
  }, []);

  const adopt = useCallback(async (id: string) => {
    generationRef.current += 1;
    viewedRef.current = id;
    setViewedId(id);
    setArchive(null);
    await refresh(id);
  }, [refresh]);

  useEffect(() => {
    const previousActive = previousActiveRef.current;
    previousActiveRef.current = activeSessionId;
    if (!viewedId) return;
    const isActive = activeSessionId === viewedId;
    const justFinished = previousActive === viewedId && !isActive;
    if (!isActive && !justFinished) return;

    let cancelled = false;
    const load = async () => {
      const session = await readCurrent(viewedId);
      if (!cancelled && session) setArchive(session);
    };
    void load();
    if (!isActive) return () => { cancelled = true; };
    const timer = globalThis.setInterval(() => void load(), 1000);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [activeSessionId, readCurrent, viewedId]);

  return { viewedId, archive, open, adopt, leave };
}
