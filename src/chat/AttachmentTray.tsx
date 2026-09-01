import type { Dict } from "../lib/i18n";
import type { AttachmentLifecycleState } from "./attachmentState";
import { AttachmentTrayItem, isTrayItem } from "./AttachmentTrayItem";

export type AttachmentTrayProps = {
  readonly t: Dict;
  readonly items: readonly AttachmentLifecycleState[];
  readonly error?: string | null;
  readonly onConfirm: (localId: string) => void;
  readonly onCancel: (localId: string) => void;
  readonly onRemove: (localId: string) => void;
  readonly onRetry: (localId: string) => void;
};

export function AttachmentTray({
  t,
  items,
  error = null,
  onCancel,
  onConfirm,
  onRemove,
  onRetry,
}: AttachmentTrayProps) {
  const visibleItems = items.filter(isTrayItem);
  if (visibleItems.length === 0 && !error) return null;

  return (
    <section
      className="chat-attachment-tray"
      aria-label={t.chatAttachmentTrayLabel}
      aria-live="polite"
    >
      {visibleItems.map((item) => (
        <AttachmentTrayItem
          key={item.localId}
          t={t}
          item={item}
          onCancel={onCancel}
          onConfirm={onConfirm}
          onRemove={onRemove}
          onRetry={onRetry}
        />
      ))}
      {error && (
        <div className="chat-attachment-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
