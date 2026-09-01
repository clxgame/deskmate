import {
  reduceAttachmentState,
  type AttachmentLifecycleState,
} from "./attachmentState";
import type { ArtifactState, LocalAttachmentArtifact } from "./useChatAttachmentsTypes";

let nextFallbackId = 0;

export function findItem(
  states: readonly AttachmentLifecycleState[],
  localId: string,
): AttachmentLifecycleState | undefined {
  return states.find((item) => item.localId === localId);
}

export function findArtifact(
  states: readonly ArtifactState[],
  artifactId: string,
): ArtifactState | undefined {
  return states.find((item) => item.artifact.id === artifactId);
}

export function reduceArtifact(
  state: ArtifactState,
  event: Parameters<typeof reduceAttachmentState>[1],
): ArtifactState {
  const next = reduceAttachmentState(state, event);
  if (next.kind === "artifact-ready" || (next.kind === "failed" && next.phase === "export")) {
    return next;
  }
  return state;
}

export function discardCurrentSource(
  state: AttachmentLifecycleState | undefined,
  sessionId: string,
  discardBackend: (sessionId: string, attachmentId: string) => void,
): void {
  switch (state?.kind) {
    case "ready":
    case "awaiting-confirmation":
    case "processing":
      discardBackend(sessionId, state.source.id);
      return;
    case "failed":
      if (state.phase === "conversion") discardBackend(sessionId, state.source.id);
      return;
    case "staging":
    case "artifact-ready":
    case "cancelled":
    case undefined:
      return;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "附件处理失败";
}

export function makeFallbackId(): string {
  nextFallbackId += 1;
  return `attachment-${nextFallbackId}`;
}

export function ignoreArtifact(_artifact: LocalAttachmentArtifact): void {}

export function ignoreBackgroundError(_message: string): void {}
