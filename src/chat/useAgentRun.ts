import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { broadcastPetActivity } from "../lib/petState";
import { cancelAgentRun, locateAgentArtifact, pendingAgentPermissions, readAgentRuns, replyAgentPermission, startAgentRun, type AgentArtifact, type AgentProjection } from "../lib/agent";
import type { PermissionReply, PermissionRequest } from "../lib/toolPermissions";
import { dict } from "../lib/i18n";

const empty: AgentProjection = { active: null, recent: [], artifacts: [] };
function isBusy(error: unknown): boolean { return error instanceof Error && /(?:^|\b)busy(?:\b|$)/i.test(error.message); }
export function useAgentRun(language: string) {
  const t = dict(language);
  const [projection, setProjection] = useState(empty);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [requests, setRequests] = useState<readonly PermissionRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const generation = useRef(0);
  const ownedRun = useRef<string | null>(null);
  const starting = useRef(false);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    try {
      const next = await readAgentRuns();
      if (token !== generation.current) return;
      const nextRequests = next.active ? await pendingAgentPermissions(next.active) : [];
      if (token !== generation.current) return;
      setProjection(next);
      if (next.active) {
        ownedRun.current = next.active.runId;
      }
      setRequests(nextRequests);
      if (next.active?.errorSummary === "history_storage_failed") setError(t.agentArchiveFailed);
      else if (next.active?.errorSummary === "agent_read_failed") setError(t.agentReadFailed);
      else setError(null);
      const latest = next.recent[0];
      if (latest && ownedRun.current === latest.runId) {
        ownedRun.current = null;
        if (latest.sessionId) broadcastPetActivity({ sessionId: latest.sessionId, requestId: latest.runId, eventId: crypto.randomUUID(), type: latest.outcome === "completed" ? "success" : "cancel" });
      }
    } catch (caught) {
      if (caught instanceof Error && token === generation.current) setError(t.agentReadFailed);
      else if (token === generation.current) setError(t.agentReadFailed);
    }
  }, [t.agentArchiveFailed, t.agentReadFailed]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!projection.active) return;
    const timer = globalThis.setInterval(() => void refresh(), 1000);
    return () => globalThis.clearInterval(timer);
  }, [projection.active, refresh]);
  const choose = useCallback(async () => {
    if (projection.active || starting.current) return null;
    try {
      const selected = await open({ directory: true, multiple: false, title: t.agentPickerTitle });
      if (typeof selected === "string") setWorkspace(selected);
      setError(null);
      return typeof selected === "string" ? selected : null;
    } catch { setError(t.agentPickerFailed); return null; }
  }, [projection.active, t.agentPickerFailed, t.agentPickerTitle]);
  const start = useCallback(async (input: string, historyId?: string) => {
    if ((!workspace && !historyId) || projection.active || starting.current || !input.trim()) return null;
    starting.current = true;
    setIsStarting(true);
    try {
      const run = await startAgentRun(historyId ? null : workspace, input.trim(), historyId);
      ownedRun.current = run.runId;
      setProjection((current) => ({ ...current, active: run }));
      if (run.sessionId) broadcastPetActivity({ sessionId: run.sessionId, requestId: run.runId, eventId: crypto.randomUUID(), type: "start" });
      await refresh();
      setError(null);
      return run;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (/agent_history_workspace_missing/.test(message)) setError(t.agentHistoryWorkspaceMissing);
      else if (/agent_history_session_missing/.test(message)) setError(t.agentHistorySessionMissing);
      else setError(caught instanceof Error && isBusy(caught) ? t.agentBusy : t.agentStartFailed);
      return null;
    } finally {
      starting.current = false;
      setIsStarting(false);
    }
  }, [projection.active, refresh, t.agentBusy, t.agentHistorySessionMissing, t.agentHistoryWorkspaceMissing, t.agentStartFailed, workspace]);
  const stop = useCallback(async () => {
    const run = projection.active;
    if (!run) return;
    try { await cancelAgentRun(run.runId); await refresh(); }
    catch { setError(t.agentCancelFailed); }
  }, [projection.active, refresh, t.agentCancelFailed]);
  const reply = useCallback(async (request: PermissionRequest, decision: PermissionReply) => {
    const run = projection.active;
    if (!run || request.sessionID !== run.sessionId) return;
    try {
      await replyAgentPermission(run.runId, request.id, decision);
      setRequests((items) => items.filter((item) => item.id !== request.id));
    } catch { setError(t.agentApprovalFailed); }
  }, [projection.active, t.agentApprovalFailed]);
  const locate = useCallback(async (artifact: AgentArtifact) => {
    try { await locateAgentArtifact(artifact.runId, artifact.reference); }
    catch { setError(t.agentArtifactFailed); }
  }, [t.agentArtifactFailed]);
  const busy = projection.active !== null || isStarting;
  const clear = useCallback(() => { if (!busy) setWorkspace(null); }, [busy]);
  const clearSelection = useCallback(() => setWorkspace(null), []);
  return { projection, workspace, requests, error, busy, choose, clear, clearSelection, start, stop, reply, locate, refresh };
}

export type AgentRunController = ReturnType<typeof useAgentRun>;
