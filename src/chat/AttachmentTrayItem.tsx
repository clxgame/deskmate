import type { Dict } from "../lib/i18n";
import { formatAttachmentSize } from "./attachments";
import type { AttachmentLifecycleState } from "./attachmentState";

export type TrayItem = Exclude<
  AttachmentLifecycleState,
  { readonly kind: "artifact-ready" } | { readonly kind: "cancelled" }
>;

export type AttachmentTrayItemProps = {
  readonly t: Dict;
  readonly item: TrayItem;
  readonly onConfirm: (localId: string) => void;
  readonly onCancel: (localId: string) => void;
  readonly onRemove: (localId: string) => void;
  readonly onRetry: (localId: string) => void;
};

export function AttachmentTrayItem({
  t,
  item,
  onCancel,
  onConfirm,
  onRemove,
  onRetry,
}: AttachmentTrayItemProps) {
  switch (item.kind) {
    case "staging":
      return (
        <AttachmentChip
          label={t.chatAttachmentStaging}
          localId={item.localId}
          name={item.draft.name}
          size={item.draft.size}
          tone="staging"
          t={t}
          onRemove={onRemove}
        />
      );
    case "ready":
      return (
        <AttachmentChip
          label={t.chatAttachmentReady}
          localId={item.localId}
          name={item.source.name}
          size={item.source.size}
          tone="ready"
          t={t}
          onRemove={onRemove}
        />
      );
    case "awaiting-confirmation":
      return (
        <NcmConfirmation
          t={t}
          item={item}
          onCancel={onCancel}
          onConfirm={onConfirm}
          onRemove={onRemove}
        />
      );
    case "processing":
      return (
        <AttachmentChip
          label={t.chatAttachmentProcessing}
          localId={item.localId}
          name={item.source.name}
          size={item.source.size}
          tone="staging"
          t={t}
          onRemove={onRemove}
        />
      );
    case "failed":
      return (
        <AttachmentFailure
          t={t}
          item={item}
          onRemove={onRemove}
          onRetry={onRetry}
        />
      );
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
}

type AttachmentChipProps = {
  readonly t: Dict;
  readonly label: string;
  readonly localId: string;
  readonly name: string;
  readonly size: number;
  readonly tone: "ready" | "staging" | "failed";
  readonly onRemove: (localId: string) => void;
};

function AttachmentChip({
  t,
  label,
  localId,
  name,
  size,
  tone,
  onRemove,
}: AttachmentChipProps) {
  return (
    <div className={`chat-attachment-chip chat-attachment-chip-${tone}`}>
      <span className="chat-attachment-name" title={name}>
        {name}
      </span>
      <span className="chat-attachment-size">{formatAttachmentSize(size)}</span>
      <span className={`chat-attachment-status chat-attachment-status-${tone}`}>
        {label}
      </span>
      <button
        className="chat-attachment-action chat-attachment-remove"
        type="button"
        onClick={() => onRemove(localId)}
        aria-label={`${t.chatAttachmentRemove} ${name}`}
      >
        {t.chatAttachmentRemove}
      </button>
    </div>
  );
}

type NcmConfirmationProps = {
  readonly t: Dict;
  readonly item: Extract<AttachmentLifecycleState, { readonly kind: "awaiting-confirmation" }>;
  readonly onConfirm: (localId: string) => void;
  readonly onCancel: (localId: string) => void;
  readonly onRemove: (localId: string) => void;
};

function NcmConfirmation({
  t,
  item,
  onCancel,
  onConfirm,
  onRemove,
}: NcmConfirmationProps) {
  const titleId = `${item.localId}-ncm-title`;
  const descriptionId = `${item.localId}-ncm-description`;
  return (
    <div className="chat-attachment-confirm-wrap">
      <AttachmentChip
        label={t.chatAttachmentReady}
        localId={item.localId}
        name={item.source.name}
        size={item.source.size}
        tone="ready"
        t={t}
        onRemove={onRemove}
      />
      <div
        className="chat-attachment-confirm"
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="chat-attachment-confirm-title" id={titleId}>
          {t.chatAttachmentNcmTitle}
        </div>
        <p className="chat-attachment-confirm-body" id={descriptionId}>
          {t.chatAttachmentNcmDescription(item.source.name)}
        </p>
        <div className="chat-attachment-confirm-actions">
          <button
            className="chat-attachment-action chat-attachment-primary"
            type="button"
            onClick={() => onConfirm(item.localId)}
          >
            {t.chatAttachmentConvertNcm}
          </button>
          <button
            className="chat-attachment-action chat-attachment-secondary"
            type="button"
            onClick={() => onCancel(item.localId)}
          >
            {t.chatAttachmentCancelNcm}
          </button>
        </div>
      </div>
    </div>
  );
}

type AttachmentFailureProps = {
  readonly t: Dict;
  readonly item: Extract<AttachmentLifecycleState, { readonly kind: "failed" }>;
  readonly onRemove: (localId: string) => void;
  readonly onRetry: (localId: string) => void;
};

function AttachmentFailure({ t, item, onRemove, onRetry }: AttachmentFailureProps) {
  const details = failedDetails(item);
  return (
    <div className="chat-attachment-chip chat-attachment-chip-failed">
      <span className="chat-attachment-name" title={details.name}>
        {details.name}
      </span>
      <span className="chat-attachment-size">{formatAttachmentSize(details.size)}</span>
      <span className="chat-attachment-status chat-attachment-status-failed" title={item.message}>
        {t.chatAttachmentFailed}
      </span>
      <button
        className="chat-attachment-action chat-attachment-retry"
        type="button"
        onClick={() => onRetry(item.localId)}
        aria-label={t.chatAttachmentRetry(details.name)}
      >
        {t.chatAttachmentRetryShort}
      </button>
      <button
        className="chat-attachment-action chat-attachment-remove"
        type="button"
        onClick={() => onRemove(item.localId)}
        aria-label={`${t.chatAttachmentRemove} ${details.name}`}
      >
        {t.chatAttachmentRemove}
      </button>
    </div>
  );
}

function failedDetails(item: Extract<AttachmentLifecycleState, { readonly kind: "failed" }>): {
  readonly name: string;
  readonly size: number;
} {
  switch (item.phase) {
    case "staging":
      return { name: item.draft.name, size: item.draft.size };
    case "conversion":
      return { name: item.source.name, size: item.source.size };
    case "export":
      return { name: item.artifact.name, size: item.artifact.size };
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
}

export function isTrayItem(state: AttachmentLifecycleState): state is TrayItem {
  return state.kind !== "artifact-ready" && state.kind !== "cancelled";
}
