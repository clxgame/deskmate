import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  asWorklogError, deleteEntry, listRuns, listSchedules, onWorklogChanged,
  recordEntry, saveSchedule, type OperationReceipt, type Run, type Schedule,
} from "../lib/worklog";
import { localWorklogDate, verifyWorklogReceipt, worklogOutput, WORKLOG_TOOLS } from "./worklogActions";
import { getSessionMessages } from "../lib/opencode";

export type ChatWorklogOperation = {
  readonly messageId: string; readonly requestId: string;
  readonly receipt: OperationReceipt | null; readonly error: string | null;
  readonly run?: Run; readonly schedule?: Schedule; readonly undoable?: boolean;
};

export function useWorklogChat(sessionId: string | null) {
  const [operations, setOperations] = useState<readonly ChatWorklogOperation[]>([]);
  const operationsRef = useRef(operations);
  const sessionRef = useRef(sessionId);
  useLayoutEffect(() => { operationsRef.current = operations; }, [operations]);
  useLayoutEffect(() => { sessionRef.current = sessionId; }, [sessionId]);

  const update = useCallback((operation: ChatWorklogOperation) => {
    setOperations((current) => [...current.filter((item) => item.requestId !== operation.requestId), operation]);
  }, []);

  const refresh = useCallback(async (operation: ChatWorklogOperation, session = sessionRef.current) => {
    if (session !== sessionRef.current) return;
    try {
      const receipt = await verifyWorklogReceipt(operation.requestId);
      if (session !== sessionRef.current) return;
      const run = receipt?.entityKind === "run" ? (await listRuns()).find((item) => item.id === receipt.entityId) : undefined;
      const schedule = receipt?.entityKind === "schedule" ? (await listSchedules()).find((item) => item.id === receipt.entityId) : undefined;
      if (session !== sessionRef.current) return;
      update({ ...operation, receipt, run, schedule, error: null });
    } catch (error: unknown) {
      if (session === sessionRef.current) update({ ...operation, error: asWorklogError(error).code });
    }
  }, [update]);

  useEffect(() => { setOperations([]); }, [sessionId]);
  useEffect(() => {
    const stop = onWorklogChanged(() => {
      for (const operation of operationsRef.current) void refresh(operation);
    }).catch((error: unknown) => {
      console.warn("Work journal live refresh unavailable", asWorklogError(error).code);
      return null;
    });
    return () => { void stop.then((unlisten) => unlisten?.()); };
  }, [refresh]);

  const acceptTool = useCallback((part: unknown) => {
    if (typeof part !== "object" || part === null || !("tool" in part) || !("messageID" in part) || !("state" in part)) return;
    if (typeof part.tool !== "string" || !WORKLOG_TOOLS.some((tool) => tool === part.tool) || typeof part.messageID !== "string") return;
    if (part.tool === "worklog_query") return;
    const state = part.state;
    if (typeof state !== "object" || state === null || !("output" in state)) return;
    const output = worklogOutput(state.output);
    if (!output) return;
    const { requestId } = output;
    const existing = operationsRef.current.find((item) => item.requestId === requestId);
    const operation = existing ?? { messageId: part.messageID, requestId, receipt: null, error: output.error, undoable: part.tool === "worklog_record" };
    update(operation);
    if (!output.error) void refresh(operation);
  }, [refresh, update]);

  const recover = useCallback(async (session: string) => {
    try {
      const messages = await getSessionMessages(session);
      if (session !== sessionRef.current) return;
      for (const message of messages) for (const part of message.parts ?? []) acceptTool(part);
    } catch (error: unknown) {
      if (error instanceof Error) console.warn("Work journal receipt recovery unavailable");
    }
  }, [acceptTool]);

  const save = useCallback(async (messageId: string, text: string) => {
    const session = sessionRef.current;
    const requestId = crypto.randomUUID();
    const operation: ChatWorklogOperation = { messageId, requestId, receipt: null, error: null, undoable: true };
    update(operation);
    try {
      await recordEntry({ requestId, businessDate: localWorklogDate(), project: null, originalText: text, text, status: "done", sourceSessionId: session, sourceMessageId: messageId });
      await refresh(operation, session);
    } catch (error: unknown) { if (session === sessionRef.current) update({ ...operation, error: asWorklogError(error).code }); }
  }, [refresh, update]);

  const schedule = useCallback(async (messageId: string) => {
    const session = sessionRef.current;
    const requestId = crypto.randomUUID();
    const operation: ChatWorklogOperation = { messageId, requestId, receipt: null, error: null };
    update(operation);
    try {
      await saveSchedule({ requestId, id: null, expectedRevision: null, kind: "weekly", weekdaySet: [5], localTime: "17:00", enabled: true });
      await refresh(operation, session);
    } catch (error: unknown) { if (session === sessionRef.current) update({ ...operation, error: asWorklogError(error).code }); }
  }, [refresh, update]);

  const undo = useCallback(async (operation: ChatWorklogOperation) => {
    const session = sessionRef.current;
    const receipt = operation.receipt;
    if (!receipt || receipt.entityKind !== "entry") return;
    try {
      await deleteEntry({ requestId: crypto.randomUUID(), id: receipt.entityId, expectedRevision: receipt.revision, deleteLinkedReports: false });
      await refresh({ ...operation, undoable: false }, session);
    } catch (error: unknown) { if (session === sessionRef.current) update({ ...operation, error: asWorklogError(error).code }); }
  }, [refresh, update]);
  return { operations, acceptTool, recover, save, schedule, undo, refresh };
}
