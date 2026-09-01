import { useCallback, useEffect, useRef, useState } from "react";
import { cleanupChatSession, convertStagedNcm, discardChatAttachment, exportChatArtifact, readChatAttachment, stageChatAttachment } from "./attachmentApi";
import { beginStagingAttachment, reduceAttachmentState, type AttachmentLifecycleState } from "./attachmentState";
import { committedAttachmentBudget } from "./useChatAttachmentBudgets";
import { discardCurrentSource, errorMessage, findArtifact, findItem, ignoreArtifact, ignoreBackgroundError, makeFallbackId, reduceArtifact } from "./useChatAttachmentsState";
import type { ArtifactState, AttachmentFileEvent, RetryUpload, UseChatAttachmentsOptions, UseChatAttachmentsResult } from "./useChatAttachmentsTypes";
import { buildPreparedModelAttachments, inferDraft, planStageUpload, prepareOpenCodeFilePart, toGeneratedArtifact, toStagedSource } from "./useChatAttachmentsUtils";

export type { ArtifactState, AttachmentFileEvent, LocalAttachmentArtifact, UseChatAttachmentsOptions, UseChatAttachmentsResult } from "./useChatAttachmentsTypes";

export function useChatAttachments(options: UseChatAttachmentsOptions): UseChatAttachmentsResult {
  const host = options.host;
  const makeLocalId = options.makeLocalId ?? makeFallbackId;
  const onArtifact = options.onArtifact ?? ignoreArtifact;
  const onBackgroundError = options.onBackgroundError ?? ignoreBackgroundError;
  const sessionIdRef = useRef(options.sessionId);
  const itemsRef = useRef<readonly AttachmentLifecycleState[]>([]);
  const artifactsRef = useRef<readonly ArtifactState[]>([]);
  const retryUploadsRef = useRef(new Map<string, RetryUpload>());
  const [items, setItems] = useState<readonly AttachmentLifecycleState[]>([]);
  const [artifacts, setArtifacts] = useState<readonly ArtifactState[]>([]);

  const setComposerItems = useCallback((next: readonly AttachmentLifecycleState[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const setArtifactItems = useCallback((next: readonly ArtifactState[]) => {
    artifactsRef.current = next;
    setArtifacts(next);
  }, []);

  const discardBackend = useCallback((sessionId: string, attachmentId: string) => {
    discardChatAttachment({ sessionId, attachmentId }, host)
      .catch((error: unknown) => onBackgroundError(errorMessage(error)));
  }, [host, onBackgroundError]);

  const dispatchItem = useCallback((localId: string, event: Parameters<typeof reduceAttachmentState>[1]) => {
    setComposerItems(itemsRef.current.map((item) => (
      item.localId === localId ? reduceAttachmentState(item, event) : item
    )));
  }, [setComposerItems]);

  const runUpload = useCallback((localId: string, retry: RetryUpload, token: number) => {
    if (retry.plan.kind === "reject") {
      dispatchItem(localId, { type: "stageFailed", operationToken: token, message: retry.plan.message });
      return;
    }
    stageChatAttachment(retry.plan.request, host)
      .then((staged) => {
        const current = findItem(itemsRef.current, localId);
        if (current?.kind !== "staging" || current.operationToken !== token) {
          discardBackend(retry.sessionId, staged.id);
          return;
        }
        retryUploadsRef.current.delete(localId);
        dispatchItem(localId, {
          type: "stageSucceeded",
          operationToken: token,
          source: toStagedSource(staged, retry.sourceKind),
        });
      })
      .catch((error: unknown) => {
        dispatchItem(localId, { type: "stageFailed", operationToken: token, message: errorMessage(error) });
      });
  }, [discardBackend, dispatchItem, host]);

  const stageFiles = useCallback((files: ArrayLike<File> | null) => {
    for (const file of Array.from(files ?? [])) {
      const localId = makeLocalId();
      const draft = inferDraft(file, localId);
      const staging = beginStagingAttachment(draft);
      const sessionId = sessionIdRef.current;
      const committed = committedAttachmentBudget(itemsRef.current, artifactsRef.current);
      setComposerItems([...itemsRef.current, staging]);
      planStageUpload(file, sessionId, committed)
        .then((plan) => {
          const retry = { sessionId, sourceKind: draft.sourceKind, plan } satisfies RetryUpload;
          retryUploadsRef.current.set(localId, retry);
          runUpload(localId, retry, staging.operationToken);
        })
        .catch((error: unknown) => {
          dispatchItem(localId, { type: "stageFailed", operationToken: staging.operationToken, message: errorMessage(error) });
        });
    }
  }, [dispatchItem, makeLocalId, runUpload, setComposerItems]);

  const stageFromEvent = useCallback((event: AttachmentFileEvent) => {
    event.preventDefault?.();
    stageFiles(event.dataTransfer?.files ?? event.clipboardData?.files ?? null);
  }, [stageFiles]);

  const runConvert = useCallback((localId: string, token: number, sourceId: string, sessionId: string) => {
    convertStagedNcm({ sessionId, attachmentId: sourceId, personaId: options.personaId }, host)
      .then((ready) => {
        const current = findItem(itemsRef.current, localId);
        const artifact = toGeneratedArtifact(ready, sourceId);
        if (current?.kind !== "processing" || current.operationToken !== token) {
          discardBackend(sessionId, artifact.id);
          return;
        }
        const next = reduceAttachmentState(current, { type: "conversionSucceeded", operationToken: token, artifact });
        if (next.kind !== "artifact-ready") return;
        setComposerItems(itemsRef.current.filter((item) => item.localId !== localId));
        setArtifactItems([...artifactsRef.current, next]);
        onArtifact({ state: next });
      })
      .catch((error: unknown) => {
        dispatchItem(localId, { type: "conversionFailed", operationToken: token, message: errorMessage(error) });
      });
  }, [discardBackend, dispatchItem, host, onArtifact, options.personaId, setArtifactItems, setComposerItems]);

  const confirm = useCallback((localId: string) => {
    const current = findItem(itemsRef.current, localId);
    if (current?.kind !== "awaiting-confirmation") return;
    const token = current.operationToken + 1;
    const sessionId = sessionIdRef.current;
    dispatchItem(localId, { type: "confirm" });
    runConvert(localId, token, current.source.id, sessionId);
  }, [dispatchItem, runConvert]);

  const cancel = useCallback((localId: string) => {
    discardCurrentSource(findItem(itemsRef.current, localId), sessionIdRef.current, discardBackend);
    retryUploadsRef.current.delete(localId);
    dispatchItem(localId, { type: "cancel" });
  }, [discardBackend, dispatchItem]);

  const remove = useCallback((localId: string) => {
    discardCurrentSource(findItem(itemsRef.current, localId), sessionIdRef.current, discardBackend);
    retryUploadsRef.current.delete(localId);
    dispatchItem(localId, { type: "remove" });
  }, [discardBackend, dispatchItem]);

  const runExport = useCallback((artifactId: string, token: number) => {
    exportChatArtifact({ sessionId: sessionIdRef.current, artifactId }, host)
      .then((receipt) => {
        setArtifactItems(artifactsRef.current.map((item) => (
          item.artifact.id === artifactId
            ? reduceArtifact(item, { type: "exportSucceeded", operationToken: token, destinationName: receipt.fileName })
            : item
        )));
      })
      .catch((error: unknown) => {
        setArtifactItems(artifactsRef.current.map((item) => (
          item.artifact.id === artifactId
            ? reduceArtifact(item, { type: "exportFailed", operationToken: token, message: errorMessage(error) })
            : item
        )));
      });
  }, [host, setArtifactItems]);

  const retry = useCallback((localId: string) => {
    const current = findItem(itemsRef.current, localId);
    if (current?.kind !== "failed") return;
    const token = current.operationToken + 1;
    dispatchItem(localId, { type: "retry" });
    switch (current.phase) {
      case "staging": {
        const retryUpload = retryUploadsRef.current.get(localId);
        if (retryUpload) runUpload(localId, retryUpload, token);
        return;
      }
      case "conversion":
        runConvert(localId, token, current.source.id, sessionIdRef.current);
        return;
      case "export":
        runExport(current.artifact.id, token);
        return;
      default: {
        const exhaustive: never = current;
        return exhaustive;
      }
    }
  }, [dispatchItem, runConvert, runExport, runUpload]);

  const download = useCallback((artifactId: string) => {
    const current = findArtifact(artifactsRef.current, artifactId);
    if (current?.kind !== "artifact-ready") return;
    const next = reduceArtifact(current, { type: "exportStarted" });
    setArtifactItems(artifactsRef.current.map((item) => (item === current ? next : item)));
    runExport(artifactId, next.operationToken);
  }, [runExport, setArtifactItems]);

  const retryDownload = useCallback((artifactId: string) => {
    const current = findArtifact(artifactsRef.current, artifactId);
    if (current?.kind !== "failed" || current.phase !== "export") return;
    const next = reduceArtifact(current, { type: "retry" });
    setArtifactItems(artifactsRef.current.map((item) => (item === current ? next : item)));
    runExport(artifactId, next.operationToken);
  }, [runExport, setArtifactItems]);

  const cleanupSession = useCallback(async (sessionId: string) => {
    if (sessionId.trim().length === 0) return;
    try {
      await cleanupChatSession({ sessionId }, host);
    } catch (error: unknown) {
      console.error(
        "chat attachment cleanup failed",
        error instanceof Error ? error : new Error(String(error)),
      );
      onBackgroundError(errorMessage(error));
    }
  }, [host, onBackgroundError]);

  const resetSession = useCallback((sessionId: string) => {
    if (sessionIdRef.current === sessionId) return;
    sessionIdRef.current = sessionId;
    retryUploadsRef.current.clear();
    setComposerItems(itemsRef.current.map((item) => reduceAttachmentState(item, { type: "sessionReset" })));
    setArtifactItems([]);
  }, [setArtifactItems, setComposerItems]);

  const discardSentSources = useCallback((localIds: readonly string[]) => {
    const sent = new Set(localIds);
    const currentSessionId = sessionIdRef.current;
    const remaining: AttachmentLifecycleState[] = [];
    for (const item of itemsRef.current) {
      if (item.kind === "ready" && sent.has(item.localId)) {
        discardBackend(currentSessionId, item.source.id);
        retryUploadsRef.current.delete(item.localId);
        continue;
      }
      remaining.push(item);
    }
    setComposerItems(remaining);
  }, [discardBackend, setComposerItems]);

	  const prepareModelAttachments = useCallback(async (message: string) => {
	    const readyItems = itemsRef.current.filter((item) => item.kind === "ready");
	    const fileParts = await Promise.all(readyItems.map(async (item) => {
	      const ready = await readChatAttachment({ sessionId: sessionIdRef.current, attachmentId: item.source.id }, host);
	      return prepareOpenCodeFilePart(ready);
	    }));
	    return buildPreparedModelAttachments(message, fileParts);
	  }, [host]);

  useEffect(() => {
    if (options.sessionId !== sessionIdRef.current) resetSession(options.sessionId);
  }, [options.sessionId, resetSession]);

  return {
    items,
    artifacts,
    stageFromPicker: stageFiles,
    stageFromDrop: stageFromEvent,
    stageFromPaste: stageFromEvent,
    confirm,
    cancel,
    remove,
    retry,
    download,
    retryDownload,
    resetSession,
    cleanupSession,
    discardSentSources,
    prepareModelAttachments,
  };
	}
