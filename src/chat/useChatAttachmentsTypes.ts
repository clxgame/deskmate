import type { AttachmentHost } from "./attachmentApi";
import type { AttachmentLifecycleState } from "./attachmentState";
import type {
  AttachmentStagePlan,
  PreparedModelAttachments,
} from "./useChatAttachmentsUtils";

export type AttachmentFileEvent = {
  readonly preventDefault?: () => void;
  readonly dataTransfer?: { readonly files: ArrayLike<File> | null };
  readonly clipboardData?: { readonly files: ArrayLike<File> | null };
};

export type ArtifactState =
  | Extract<AttachmentLifecycleState, { readonly kind: "artifact-ready" }>
  | (Extract<AttachmentLifecycleState, { readonly kind: "failed" }> & {
      readonly phase: "export";
    });

export type LocalAttachmentArtifact = {
  readonly state: Extract<AttachmentLifecycleState, { readonly kind: "artifact-ready" }>;
};

export type RetryUpload = {
  readonly sessionId: string;
  readonly sourceKind: "ordinary" | "ncm";
  readonly plan: AttachmentStagePlan;
};

export type UseChatAttachmentsOptions = {
  readonly sessionId: string;
  readonly personaId: string;
  readonly host?: AttachmentHost;
  readonly makeLocalId?: () => string;
  readonly onArtifact?: (artifact: LocalAttachmentArtifact) => void;
  readonly onBackgroundError?: (message: string) => void;
};

export type UseChatAttachmentsResult = {
  readonly items: readonly AttachmentLifecycleState[];
  readonly artifacts: readonly ArtifactState[];
  readonly stageFromPicker: (files: ArrayLike<File> | null) => void;
  readonly stageFromDrop: (event: AttachmentFileEvent) => void;
  readonly stageFromPaste: (event: AttachmentFileEvent) => void;
  readonly confirm: (localId: string) => void;
  readonly cancel: (localId: string) => void;
  readonly remove: (localId: string) => void;
  readonly retry: (localId: string) => void;
  readonly download: (artifactId: string) => void;
  readonly retryDownload: (artifactId: string) => void;
  readonly resetSession: (sessionId: string) => void;
  readonly cleanupSession: (sessionId: string) => Promise<void>;
  readonly discardSentSources: (localIds: readonly string[]) => void;
  readonly prepareModelAttachments: (message: string) => Promise<PreparedModelAttachments>;
};
