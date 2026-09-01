export type StagedSourceKind = "ordinary" | "ncm";

export const ATTACHMENT_STATE_KINDS = [
  "staging",
  "ready",
  "awaiting-confirmation",
  "processing",
  "artifact-ready",
  "failed",
  "cancelled",
] as const;

export const ATTACHMENT_EVENT_TYPES = [
  "stageSucceeded",
  "stageFailed",
  "confirm",
  "cancel",
  "conversionSucceeded",
  "conversionFailed",
  "retry",
  "exportStarted",
  "exportSucceeded",
  "exportFailed",
  "remove",
  "sessionReset",
] as const;

export type AttachmentStateKind = (typeof ATTACHMENT_STATE_KINDS)[number];
export type AttachmentEventType = (typeof ATTACHMENT_EVENT_TYPES)[number];

export type AttachmentDraft = {
  readonly localId: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly sourceKind: StagedSourceKind;
};

export type StagedSource = {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly kind: StagedSourceKind;
};

export type GeneratedArtifact = {
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly previewDataUrl: string;
};

type ExportState =
  | { readonly kind: "idle" }
  | { readonly kind: "exporting" }
  | { readonly kind: "exported"; readonly destinationName: string };
type CancelReason = "user" | "removed" | "session-reset";
type BaseState<K extends AttachmentStateKind> = {
  readonly kind: K;
  readonly localId: string;
  readonly operationToken: number;
};
type FailedState =
  | BaseState<"failed"> & { readonly phase: "staging"; readonly draft: AttachmentDraft; readonly message: string }
  | BaseState<"failed"> & { readonly phase: "conversion"; readonly source: StagedSource; readonly message: string }
  | BaseState<"failed"> & { readonly phase: "export"; readonly artifact: GeneratedArtifact; readonly message: string };

export type AttachmentLifecycleState =
  | BaseState<"staging"> & { readonly draft: AttachmentDraft }
  | BaseState<"ready"> & { readonly source: StagedSource }
  | BaseState<"awaiting-confirmation"> & { readonly source: StagedSource }
  | BaseState<"processing"> & { readonly source: StagedSource }
  | BaseState<"artifact-ready"> & { readonly artifact: GeneratedArtifact; readonly exportState: ExportState }
  | FailedState
  | BaseState<"cancelled"> & { readonly name: string; readonly reason: CancelReason };

export type AttachmentEvent =
  | { readonly type: "stageSucceeded"; readonly operationToken: number; readonly source: StagedSource }
  | { readonly type: "stageFailed"; readonly operationToken: number; readonly message: string }
  | { readonly type: "confirm" }
  | { readonly type: "cancel" }
  | { readonly type: "conversionSucceeded"; readonly operationToken: number; readonly artifact: GeneratedArtifact }
  | { readonly type: "conversionFailed"; readonly operationToken: number; readonly message: string }
  | { readonly type: "retry" }
  | { readonly type: "exportStarted" }
  | { readonly type: "exportSucceeded"; readonly operationToken: number; readonly destinationName: string }
  | { readonly type: "exportFailed"; readonly operationToken: number; readonly message: string }
  | { readonly type: "remove" }
  | { readonly type: "sessionReset" };

export function beginStagingAttachment(
  draft: AttachmentDraft,
): AttachmentLifecycleState {
  return { kind: "staging", localId: draft.localId, draft, operationToken: 1 };
}

export function reduceAttachmentState(
  state: AttachmentLifecycleState,
  event: AttachmentEvent,
): AttachmentLifecycleState {
  switch (event.type) {
    case "stageSucceeded":
      return state.kind === "staging" && matches(state, event) ? staged(state, event.source) : state;
    case "stageFailed":
      return state.kind === "staging" && matches(state, event) ? { kind: "failed", localId: state.localId, phase: "staging", draft: state.draft, operationToken: state.operationToken, message: event.message } : state;
    case "confirm":
      return state.kind === "awaiting-confirmation" ? { kind: "processing", localId: state.localId, source: state.source, operationToken: next(state) } : state;
    case "cancel":
      return state.kind === "artifact-ready" ? state : cancelActive(state, "user");
    case "conversionSucceeded":
      return state.kind === "processing" && matches(state, event) ? { kind: "artifact-ready", localId: state.localId, artifact: event.artifact, exportState: { kind: "idle" }, operationToken: state.operationToken } : state;
    case "conversionFailed":
      return state.kind === "processing" && matches(state, event) ? { kind: "failed", localId: state.localId, phase: "conversion", source: state.source, operationToken: state.operationToken, message: event.message } : state;
    case "retry":
      return state.kind === "failed" ? retryFailed(state) : state;
    case "exportStarted":
      return startExport(state);
    case "exportSucceeded":
      return finishExport(state, event);
    case "exportFailed":
      return failExport(state, event);
    case "remove":
      return cancelActive(state, "removed");
    case "sessionReset":
      return cancelActive(state, "session-reset");
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function staged(
  state: Extract<AttachmentLifecycleState, { readonly kind: "staging" }>,
  source: StagedSource,
): AttachmentLifecycleState {
  switch (source.kind) {
    case "ordinary":
      return { kind: "ready", localId: state.localId, source, operationToken: state.operationToken };
    case "ncm":
      return { kind: "awaiting-confirmation", localId: state.localId, source, operationToken: state.operationToken };
    default: {
      const exhaustive: never = source.kind;
      return exhaustive;
    }
  }
}

function startExport(state: AttachmentLifecycleState): AttachmentLifecycleState {
  if (state.kind !== "artifact-ready") return state;
  switch (state.exportState.kind) {
    case "exporting":
      return state;
    case "idle":
    case "exported":
      return { kind: "artifact-ready", localId: state.localId, artifact: state.artifact, exportState: { kind: "exporting" }, operationToken: next(state) };
    default: {
      const exhaustive: never = state.exportState;
      return exhaustive;
    }
  }
}

function finishExport(
  state: AttachmentLifecycleState,
  event: Extract<AttachmentEvent, { readonly type: "exportSucceeded" }>,
): AttachmentLifecycleState {
  if (state.kind !== "artifact-ready") return state;
  if (state.exportState.kind !== "exporting" || !matches(state, event)) return state;
  return { kind: "artifact-ready", localId: state.localId, artifact: state.artifact, exportState: { kind: "exported", destinationName: event.destinationName }, operationToken: state.operationToken };
}

function failExport(
  state: AttachmentLifecycleState,
  event: Extract<AttachmentEvent, { readonly type: "exportFailed" }>,
): AttachmentLifecycleState {
  if (state.kind !== "artifact-ready") return state;
  if (state.exportState.kind !== "exporting" || !matches(state, event)) return state;
  return { kind: "failed", localId: state.localId, phase: "export", artifact: state.artifact, operationToken: state.operationToken, message: event.message };
}

function retryFailed(state: FailedState): AttachmentLifecycleState {
  switch (state.phase) {
    case "staging":
      return { kind: "staging", localId: state.localId, draft: state.draft, operationToken: next(state) };
    case "conversion":
      return { kind: "processing", localId: state.localId, source: state.source, operationToken: next(state) };
    case "export":
      return { kind: "artifact-ready", localId: state.localId, artifact: state.artifact, exportState: { kind: "exporting" }, operationToken: next(state) };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function cancelActive(
  state: AttachmentLifecycleState,
  reason: CancelReason,
): AttachmentLifecycleState {
  switch (state.kind) {
    case "cancelled":
      return state;
    case "staging":
      return cancelByName(state, state.draft.name, reason);
    case "ready":
    case "awaiting-confirmation":
    case "processing":
      return cancelByName(state, state.source.name, reason);
    case "artifact-ready":
      return cancelByName(state, state.artifact.name, reason);
    case "failed":
      return cancelFailed(state, reason);
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function cancelFailed(
  state: FailedState,
  reason: CancelReason,
): AttachmentLifecycleState {
  switch (state.phase) {
    case "staging":
      return cancelByName(state, state.draft.name, reason);
    case "conversion":
      return cancelByName(state, state.source.name, reason);
    case "export":
      return cancelByName(state, state.artifact.name, reason);
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function cancelByName(
  state: AttachmentLifecycleState,
  name: string,
  reason: CancelReason,
): AttachmentLifecycleState {
  return { kind: "cancelled", localId: state.localId, name, reason, operationToken: next(state) };
}

function matches(
  state: AttachmentLifecycleState,
  event: { readonly operationToken: number },
): boolean {
  return state.operationToken === event.operationToken;
}

function next(state: AttachmentLifecycleState): number {
  return state.operationToken + 1;
}
