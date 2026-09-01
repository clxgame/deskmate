import { MAX_ATTACHMENT_BYTES } from "./attachments";
import type { AttachmentLifecycleState } from "./attachmentState";

const MIB = 1024 * 1024;
export const MAX_NCM_ATTACHMENT_BYTES = 64 * MIB;
export const MAX_SESSION_ATTACHMENT_BYTES = 64 * MIB;

export type AttachmentBudget = {
  readonly ordinaryBytes: number;
  readonly totalBytes: number;
};

type RetainedArtifactBudgetState = {
  readonly artifact: { readonly size: number };
};

export function committedAttachmentBudget(
  states: readonly AttachmentLifecycleState[],
  artifacts: readonly RetainedArtifactBudgetState[] = [],
): AttachmentBudget {
  const sourceBudget = states.reduce(
    (budget, state) => addBudget(budget, budgetOfState(state)),
    { ordinaryBytes: 0, totalBytes: 0 },
  );
  return artifacts.reduce(
    (budget, state) => addBudget(budget, { ordinaryBytes: 0, totalBytes: state.artifact.size }),
    sourceBudget,
  );
}

export function itemLimitForSource(sourceKind: "ordinary" | "ncm"): number {
  switch (sourceKind) {
    case "ordinary":
      return MAX_ATTACHMENT_BYTES;
    case "ncm":
      return MAX_NCM_ATTACHMENT_BYTES;
    default: {
      const exhaustive: never = sourceKind;
      return exhaustive;
    }
  }
}

export function nextBudget(
  current: AttachmentBudget,
  sourceKind: "ordinary" | "ncm",
  size: number,
): AttachmentBudget {
  return {
    ordinaryBytes: current.ordinaryBytes + (sourceKind === "ordinary" ? size : 0),
    totalBytes: current.totalBytes + size,
  };
}

function addBudget(left: AttachmentBudget, right: AttachmentBudget): AttachmentBudget {
  return {
    ordinaryBytes: left.ordinaryBytes + right.ordinaryBytes,
    totalBytes: left.totalBytes + right.totalBytes,
  };
}

function budgetOfState(state: AttachmentLifecycleState): AttachmentBudget {
  switch (state.kind) {
    case "staging":
      return budgetOfSource(state.draft.sourceKind, state.draft.size);
    case "ready":
    case "awaiting-confirmation":
    case "processing":
      return budgetOfSource(state.source.kind, state.source.size);
    case "artifact-ready":
      return { ordinaryBytes: 0, totalBytes: state.artifact.size };
    case "failed":
      switch (state.phase) {
        case "staging":
          return budgetOfSource(state.draft.sourceKind, state.draft.size);
        case "conversion":
          return budgetOfSource(state.source.kind, state.source.size);
        case "export":
          return { ordinaryBytes: 0, totalBytes: state.artifact.size };
        default: {
          const exhaustive: never = state;
          return exhaustive;
        }
      }
    case "cancelled":
      return { ordinaryBytes: 0, totalBytes: 0 };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function budgetOfSource(sourceKind: "ordinary" | "ncm", size: number): AttachmentBudget {
  return {
    ordinaryBytes: sourceKind === "ordinary" ? size : 0,
    totalBytes: size,
  };
}
