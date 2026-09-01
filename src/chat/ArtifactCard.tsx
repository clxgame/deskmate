import type { Dict } from "../lib/i18n";
import { formatAttachmentSize } from "./attachments";
import type { AttachmentLifecycleState, GeneratedArtifact } from "./attachmentState";

export type ArtifactCardState =
  | Extract<AttachmentLifecycleState, { readonly kind: "artifact-ready" }>
  | (Extract<AttachmentLifecycleState, { readonly kind: "failed" }> & {
      readonly phase: "export";
    });

export type ArtifactCardProps = {
  readonly t: Dict;
  readonly state: ArtifactCardState;
  readonly onDownload: (artifactId: string) => void;
  readonly onRetry: (artifactId: string) => void;
};

export function ArtifactCard({ t, state, onDownload, onRetry }: ArtifactCardProps) {
  const artifact = artifactFromState(state);
  return (
    <article
      className="chat-artifact-row"
      aria-label={t.chatArtifactCardLabel(artifact.name)}
    >
      <div className="chat-artifact-card">
        <div className="chat-artifact-head">
          <div className="chat-artifact-meta">
            <div className="chat-artifact-title">{artifact.name}</div>
            <div className="chat-artifact-size">{formatAttachmentSize(artifact.size)}</div>
          </div>
          {renderExportControl(t, state, artifact, onDownload, onRetry)}
        </div>
        <audio
          className="chat-artifact-audio"
          controls
          preload="metadata"
          src={artifact.previewDataUrl}
          aria-label={t.chatArtifactAudioPreview(artifact.name)}
        />
        {renderExportFeedback(t, state)}
      </div>
    </article>
  );
}

function renderExportControl(
  t: Dict,
  state: ArtifactCardState,
  artifact: GeneratedArtifact,
  onDownload: (artifactId: string) => void,
  onRetry: (artifactId: string) => void,
) {
  if (state.kind === "failed") {
    return (
      <button
        className="chat-artifact-retry"
        type="button"
        onClick={() => onRetry(artifact.id)}
      >
        {t.chatArtifactRetryDownload}
      </button>
    );
  }

  switch (state.exportState.kind) {
    case "idle":
    case "exported":
      return (
        <button
          className="chat-artifact-download"
          type="button"
          onClick={() => onDownload(artifact.id)}
        >
          {t.chatArtifactDownload}
        </button>
      );
    case "exporting":
      return (
        <button className="chat-artifact-download" type="button" disabled>
          {t.chatArtifactSaving}
        </button>
      );
    default: {
      const exhaustive: never = state.exportState;
      return exhaustive;
    }
  }
}

function renderExportFeedback(t: Dict, state: ArtifactCardState) {
  if (state.kind === "failed") {
    return (
      <div className="chat-artifact-feedback chat-artifact-feedback-error" role="alert">
        {t.chatArtifactSaveFailed(state.message)}
      </div>
    );
  }

  switch (state.exportState.kind) {
    case "idle":
    case "exporting":
      return null;
    case "exported":
      return (
        <div className="chat-artifact-feedback" role="status" aria-live="polite">
          {t.chatArtifactSaved(state.exportState.destinationName)}
        </div>
      );
    default: {
      const exhaustive: never = state.exportState;
      return exhaustive;
    }
  }
}

function artifactFromState(state: ArtifactCardState): GeneratedArtifact {
  switch (state.kind) {
    case "artifact-ready":
      return state.artifact;
    case "failed":
      return state.artifact;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
