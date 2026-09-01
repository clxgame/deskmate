import { describe, expect, it } from "bun:test";
import {
  ATTACHMENT_EVENT_TYPES,
  ATTACHMENT_STATE_KINDS,
  beginStagingAttachment,
  reduceAttachmentState,
  type AttachmentDraft,
  type AttachmentEvent,
  type AttachmentEventType,
  type AttachmentLifecycleState,
  type AttachmentStateKind,
  type GeneratedArtifact,
  type StagedSource,
} from "./attachmentState";

const ncmDraft: AttachmentDraft = {
  localId: "local-ncm",
  name: "song.ncm",
  mime: "application/vnd.netease.ncm",
  size: 42,
  sourceKind: "ncm",
};

const ordinaryDraft: AttachmentDraft = {
  localId: "local-md",
  name: "notes.md",
  mime: "text/markdown",
  size: 12,
  sourceKind: "ordinary",
};

const ncmSource: StagedSource = {
  id: "stage-ncm",
  name: "song.ncm",
  mime: "application/vnd.netease.ncm",
  size: 42,
  kind: "ncm",
};

const ordinarySource: StagedSource = {
  id: "stage-md",
  name: "notes.md",
  mime: "text/markdown",
  size: 12,
  kind: "ordinary",
};

const artifact: GeneratedArtifact = {
  id: "artifact-flac",
  sourceId: "stage-ncm",
  name: "song.flac",
  mime: "audio/flac",
  size: 256,
  previewDataUrl: "data:audio/flac;base64,AAAA",
};

const TOKEN = 1;
const NEXT_TOKEN = 2;

const STATES = {
  staging: beginStagingAttachment(ncmDraft),
  ready: { kind: "ready", localId: ordinaryDraft.localId, source: ordinarySource, operationToken: TOKEN },
  "awaiting-confirmation": { kind: "awaiting-confirmation", localId: ncmDraft.localId, source: ncmSource, operationToken: TOKEN },
  processing: { kind: "processing", localId: ncmDraft.localId, source: ncmSource, operationToken: TOKEN },
  "artifact-ready": { kind: "artifact-ready", localId: ncmDraft.localId, artifact, exportState: { kind: "idle" }, operationToken: TOKEN },
  failed: { kind: "failed", localId: ncmDraft.localId, phase: "staging", draft: ncmDraft, message: "stage failed", operationToken: TOKEN },
  cancelled: { kind: "cancelled", localId: ncmDraft.localId, name: ncmDraft.name, reason: "user", operationToken: NEXT_TOKEN },
} satisfies Record<AttachmentStateKind, AttachmentLifecycleState>;

const EXTRA_STATES = {
  exporting: { kind: "artifact-ready", localId: ncmDraft.localId, artifact, exportState: { kind: "exporting" }, operationToken: TOKEN },
  conversionFailed: { kind: "failed", localId: ncmDraft.localId, phase: "conversion", source: ncmSource, message: "conversion failed", operationToken: TOKEN },
  exportFailed: { kind: "failed", localId: ncmDraft.localId, phase: "export", artifact, message: "export failed", operationToken: TOKEN },
} satisfies Record<string, AttachmentLifecycleState>;

const EVENTS = {
  stageSucceeded: { type: "stageSucceeded", operationToken: TOKEN, source: ordinarySource },
  stageFailed: { type: "stageFailed", operationToken: TOKEN, message: "stage failed" },
  confirm: { type: "confirm" },
  cancel: { type: "cancel" },
  conversionSucceeded: { type: "conversionSucceeded", operationToken: TOKEN, artifact },
  conversionFailed: { type: "conversionFailed", operationToken: TOKEN, message: "conversion failed" },
  retry: { type: "retry" },
  exportStarted: { type: "exportStarted" },
  exportSucceeded: { type: "exportSucceeded", operationToken: TOKEN, destinationName: "song.flac" },
  exportFailed: { type: "exportFailed", operationToken: TOKEN, message: "export failed" },
  remove: { type: "remove" },
  sessionReset: { type: "sessionReset" },
} satisfies Record<AttachmentEventType, AttachmentEvent>;

const NO_OP_EVENTS = {
  staging: ["confirm", "conversionSucceeded", "conversionFailed", "retry", "exportStarted", "exportSucceeded", "exportFailed"],
  ready: ["stageSucceeded", "stageFailed", "confirm", "conversionSucceeded", "conversionFailed", "retry", "exportStarted", "exportSucceeded", "exportFailed"],
  "awaiting-confirmation": ["stageSucceeded", "stageFailed", "conversionSucceeded", "conversionFailed", "retry", "exportStarted", "exportSucceeded", "exportFailed"],
  processing: ["stageSucceeded", "stageFailed", "confirm", "retry", "exportStarted", "exportSucceeded", "exportFailed"],
  "artifact-ready": ["stageSucceeded", "stageFailed", "confirm", "cancel", "conversionSucceeded", "conversionFailed", "retry"],
  failed: ["stageSucceeded", "stageFailed", "confirm", "conversionSucceeded", "conversionFailed", "exportStarted", "exportSucceeded", "exportFailed"],
  cancelled: ATTACHMENT_EVENT_TYPES,
} as const satisfies Record<AttachmentStateKind, readonly AttachmentEventType[]>;

type ExpectedTransition = {
  readonly kind: AttachmentStateKind;
  readonly operationToken: number;
  readonly phase?: "staging" | "conversion" | "export";
  readonly reason?: "user" | "removed" | "session-reset";
  readonly exportState?: { readonly kind: "idle" | "exporting" | "exported"; readonly destinationName?: string };
};

type TransitionCase = {
  readonly name: string;
  readonly state: AttachmentLifecycleState;
  readonly event: AttachmentEvent;
  readonly expected: ExpectedTransition;
};

const LEGAL_TRANSITIONS = [
  { name: "staging ordinary success", state: beginStagingAttachment(ordinaryDraft), event: { ...EVENTS.stageSucceeded, source: ordinarySource }, expected: { kind: "ready", operationToken: TOKEN } },
  { name: "staging ncm success", state: STATES.staging, event: { ...EVENTS.stageSucceeded, source: ncmSource }, expected: { kind: "awaiting-confirmation", operationToken: TOKEN } },
  { name: "staging failure", state: STATES.staging, event: EVENTS.stageFailed, expected: { kind: "failed", phase: "staging", operationToken: TOKEN } },
  { name: "staging cancel", state: STATES.staging, event: EVENTS.cancel, expected: { kind: "cancelled", reason: "user", operationToken: NEXT_TOKEN } },
  { name: "staging remove", state: STATES.staging, event: EVENTS.remove, expected: { kind: "cancelled", reason: "removed", operationToken: NEXT_TOKEN } },
  { name: "staging session reset", state: STATES.staging, event: EVENTS.sessionReset, expected: { kind: "cancelled", reason: "session-reset", operationToken: NEXT_TOKEN } },
  { name: "ready cancel", state: STATES.ready, event: EVENTS.cancel, expected: { kind: "cancelled", reason: "user", operationToken: NEXT_TOKEN } },
  { name: "ready remove", state: STATES.ready, event: EVENTS.remove, expected: { kind: "cancelled", reason: "removed", operationToken: NEXT_TOKEN } },
  { name: "ready session reset", state: STATES.ready, event: EVENTS.sessionReset, expected: { kind: "cancelled", reason: "session-reset", operationToken: NEXT_TOKEN } },
  { name: "awaiting confirmation", state: STATES["awaiting-confirmation"], event: EVENTS.confirm, expected: { kind: "processing", operationToken: NEXT_TOKEN } },
  { name: "awaiting cancel", state: STATES["awaiting-confirmation"], event: EVENTS.cancel, expected: { kind: "cancelled", reason: "user", operationToken: NEXT_TOKEN } },
  { name: "awaiting remove", state: STATES["awaiting-confirmation"], event: EVENTS.remove, expected: { kind: "cancelled", reason: "removed", operationToken: NEXT_TOKEN } },
  { name: "awaiting session reset", state: STATES["awaiting-confirmation"], event: EVENTS.sessionReset, expected: { kind: "cancelled", reason: "session-reset", operationToken: NEXT_TOKEN } },
  { name: "processing cancel", state: STATES.processing, event: EVENTS.cancel, expected: { kind: "cancelled", reason: "user", operationToken: NEXT_TOKEN } },
  { name: "processing success", state: STATES.processing, event: EVENTS.conversionSucceeded, expected: { kind: "artifact-ready", exportState: { kind: "idle" }, operationToken: TOKEN } },
  { name: "processing failure", state: STATES.processing, event: EVENTS.conversionFailed, expected: { kind: "failed", phase: "conversion", operationToken: TOKEN } },
  { name: "processing remove", state: STATES.processing, event: EVENTS.remove, expected: { kind: "cancelled", reason: "removed", operationToken: NEXT_TOKEN } },
  { name: "processing session reset", state: STATES.processing, event: EVENTS.sessionReset, expected: { kind: "cancelled", reason: "session-reset", operationToken: NEXT_TOKEN } },
  { name: "artifact export start", state: STATES["artifact-ready"], event: EVENTS.exportStarted, expected: { kind: "artifact-ready", exportState: { kind: "exporting" }, operationToken: NEXT_TOKEN } },
  { name: "artifact export success", state: EXTRA_STATES.exporting, event: EVENTS.exportSucceeded, expected: { kind: "artifact-ready", exportState: { kind: "exported", destinationName: "song.flac" }, operationToken: TOKEN } },
  { name: "artifact export failure", state: EXTRA_STATES.exporting, event: EVENTS.exportFailed, expected: { kind: "failed", phase: "export", operationToken: TOKEN } },
  { name: "artifact remove", state: STATES["artifact-ready"], event: EVENTS.remove, expected: { kind: "cancelled", reason: "removed", operationToken: NEXT_TOKEN } },
  { name: "artifact session reset", state: STATES["artifact-ready"], event: EVENTS.sessionReset, expected: { kind: "cancelled", reason: "session-reset", operationToken: NEXT_TOKEN } },
  { name: "failed retry", state: STATES.failed, event: EVENTS.retry, expected: { kind: "staging", operationToken: NEXT_TOKEN } },
  { name: "failed cancel", state: STATES.failed, event: EVENTS.cancel, expected: { kind: "cancelled", reason: "user", operationToken: NEXT_TOKEN } },
  { name: "failed remove", state: STATES.failed, event: EVENTS.remove, expected: { kind: "cancelled", reason: "removed", operationToken: NEXT_TOKEN } },
  { name: "failed session reset", state: STATES.failed, event: EVENTS.sessionReset, expected: { kind: "cancelled", reason: "session-reset", operationToken: NEXT_TOKEN } },
] satisfies readonly TransitionCase[];

const RETRY_PHASES = [
  { name: "conversion", state: EXTRA_STATES.conversionFailed, expected: { kind: "processing", operationToken: NEXT_TOKEN } },
  { name: "export", state: EXTRA_STATES.exportFailed, expected: { kind: "artifact-ready", exportState: { kind: "exporting" }, operationToken: NEXT_TOKEN } },
] satisfies readonly Omit<TransitionCase, "event">[];

describe("attachment lifecycle reducer transition matrix", () => {
  for (const testCase of LEGAL_TRANSITIONS) {
    it(`performs declared legal transition: ${testCase.name}`, () => {
      const result = reduceAttachmentState(testCase.state, testCase.event);

      expect(result).toMatchObject(testCase.expected);
    });
  }

  for (const testCase of RETRY_PHASES) {
    it(`retries the ${testCase.name} failed phase`, () => {
      const result = reduceAttachmentState(testCase.state, EVENTS.retry);

      expect(result).toMatchObject(testCase.expected);
    });
  }

  for (const stateKind of ATTACHMENT_STATE_KINDS) {
    for (const eventType of NO_OP_EVENTS[stateKind]) {
      it(`preserves ${stateKind} for declared ${eventType} no-op`, () => {
        const state = STATES[stateKind];
        const result = reduceAttachmentState(state, EVENTS[eventType]);

        expect(result).toBe(state);
      });
    }
  }

  it("preserves active staging when stageSucceeded carries a stale token", () => {
    const state = STATES.staging;
    const event = { ...EVENTS.stageSucceeded, operationToken: NEXT_TOKEN };

    expectStaleEventToPreserveState(state, event);
  });

  it("preserves active staging when stageFailed carries a stale token", () => {
    const state = STATES.staging;
    const event = { ...EVENTS.stageFailed, operationToken: NEXT_TOKEN };

    expectStaleEventToPreserveState(state, event);
  });

  it("preserves active processing when conversionSucceeded carries a stale token", () => {
    const state = STATES.processing;
    const event = { ...EVENTS.conversionSucceeded, operationToken: NEXT_TOKEN };

    expectStaleEventToPreserveState(state, event);
  });

  it("preserves active processing when conversionFailed carries a stale token", () => {
    const state = STATES.processing;
    const event = { ...EVENTS.conversionFailed, operationToken: NEXT_TOKEN };

    expectStaleEventToPreserveState(state, event);
  });

  it("preserves active export when exportSucceeded carries a stale token", () => {
    const state = EXTRA_STATES.exporting;
    const event = { ...EVENTS.exportSucceeded, operationToken: NEXT_TOKEN };

    expectStaleEventToPreserveState(state, event);
  });

  it("preserves active export when exportFailed carries a stale token", () => {
    const state = EXTRA_STATES.exporting;
    const event = { ...EVENTS.exportFailed, operationToken: NEXT_TOKEN };

    expectStaleEventToPreserveState(state, event);
  });

  it("ignores stale completion after cancellation", () => {
    const cancelled = reduceAttachmentState(STATES.staging, EVENTS.cancel);
    const result = reduceAttachmentState(cancelled, EVENTS.stageSucceeded);

    expect(result).toBe(cancelled);
  });
});

function expectStaleEventToPreserveState(
  state: AttachmentLifecycleState,
  event: AttachmentEvent,
): void {
  const before = JSON.stringify(state);
  const result = reduceAttachmentState(state, event);

  expect(result).toBe(state);
  expect(JSON.stringify(state)).toBe(before);
}
