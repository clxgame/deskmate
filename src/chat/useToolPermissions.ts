import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cancelPermissions, pendingPermissions, replyPermission, type PermissionReply, type PermissionRequest } from "../lib/toolPermissions";

export function useToolPermissions(sessionId: string | null, busy: boolean) {
  const [requests, setRequests] = useState<readonly PermissionRequest[]>([]);
  const [error, setError] = useState(false);
  const currentSession = useRef(sessionId);
  const busyRef = useRef(busy);
  useLayoutEffect(() => {
    currentSession.current = sessionId;
    busyRef.current = busy;
  }, [sessionId, busy]);

  useEffect(() => {
    setRequests([]);
    setError(false);
    if (!sessionId || !busy) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await pendingPermissions(sessionId);
        if (!disposed) { setRequests(next); setError(false); }
      } catch (error: unknown) {
        if (!disposed && busyRef.current) {
          setError(true);
          console.error("Tool permission check failed", error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      void cancelPermissions(sessionId).catch((error: unknown) => {
        console.error("Tool permission cancellation failed", error instanceof Error ? error.message : String(error));
      });
    };
  }, [sessionId, busy]);

  const reply = useCallback(async (request: PermissionRequest, decision: PermissionReply) => {
    if (request.sessionID !== currentSession.current || !busyRef.current) return;
    try {
      await replyPermission(request.sessionID, request.id, decision);
      if (request.sessionID === currentSession.current) {
        setRequests((previous) => previous.filter((item) => item.id !== request.id));
        setError(false);
      }
    } catch (error: unknown) {
      if (request.sessionID === currentSession.current) setError(true);
      console.error("Tool permission reply failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, []);
  return { requests, error, reply };
}
