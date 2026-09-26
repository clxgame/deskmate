import { useEffect, useId, useRef, useState } from "react";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import type { CatalogMutation, CatalogPreview, UnifiedHistoryRow } from "../lib/unifiedHistory";
import { readOnlyLabel, type HistoryCopy } from "./historyOrganizerCopy";
import { timeLabel } from "./historyOrganizerPresentation";

interface RowProps {
  readonly row: UnifiedHistoryRow;
  readonly copy: HistoryCopy;
  readonly language: string;
  readonly group: string;
  readonly now: Date;
  readonly projectName: string;
  readonly preview?: CatalogPreview;
  readonly busy: boolean;
  readonly menuOpen: boolean;
  readonly onMenuChange: (open: boolean) => void;
  readonly onOpen: (row: UnifiedHistoryRow) => void;
  readonly onMutate: (row: UnifiedHistoryRow, mutation: CatalogMutation, forgetMemories?: boolean) => Promise<boolean>;
}
export function HistoryOrganizerRow({ row, copy, language, group, now, projectName, preview, busy, menuOpen, onMenuChange, onOpen, onMutate }: RowProps) {
  const [mode, setMode] = useState<"closed" | "rename" | "delete" | "details">("closed");
  const [title, setTitle] = useState(row.displayTitle);
  const [forgetMemories, setForgetMemories] = useState(true);
  const [menuPosition, setMenuPosition] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number }>({ top: 0, right: 8, maxHeight: 370 });
  const availabilityLabel = row.availability === "available" ? null : copy[row.availability];
  const readOnly = row.capabilities.send ? null : readOnlyLabel(row.capabilities.readOnlyReason, copy);
  const actionId = useId();
  const titleId = useId();
  const actionButton = useRef<HTMLButtonElement>(null);
  const actionPanel = useRef<HTMLDivElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mode === "rename") titleInput.current?.focus();
    if (mode === "delete") cancelButton.current?.focus();
  }, [mode]);
  useEffect(() => { if (!menuOpen && mode !== "closed") setMode("closed"); }, [menuOpen, mode]);
  const close = () => { setMode("closed"); onMenuChange(false); actionButton.current?.focus(); };
  const mutate = async (mutation: CatalogMutation) => { if (await onMutate(row, mutation, forgetMemories)) close(); };
  const excerpt = preview?.status === "ready" ? `${preview.localOnly ? `${copy.localReply} · ` : ""}${preview.text ?? ""}`
    : preview?.status === "empty" ? copy.previewEmpty : preview?.status === "unavailable" ? copy.previewUnavailable : copy.previewLoading;
  const time = new Date(row.updated);
  return <li className="history-organizer-row" data-preview-key={row.key}>
    <div className="history-organizer-row-main">
      <button type="button" className="history-organizer-open" disabled={!row.capabilities.open || busy}
        aria-label={`${copy.open} ${row.displayTitle}`} onClick={() => onOpen(row)}>
        <span className="history-organizer-row-top">
          <span className="history-organizer-row-title" title={row.displayTitle}>{row.displayTitle}</span>
          <time dateTime={time.toISOString()} title={time.toLocaleString(language)}>{timeLabel(row.updated, group, now, language, copy)}</time>
        </span>
        <span className="history-organizer-excerpt">{excerpt}</span>
        <span className="history-organizer-row-foot">
          <span className="history-organizer-project" title={row.identity.kind === "native" ? row.identity.directory : undefined}>{projectName}</span>
          {availabilityLabel && <span className="history-organizer-warning">{availabilityLabel}</span>}
          {readOnly && readOnly !== availabilityLabel && <span>{readOnly}</span>}
        </span>
      </button>
      <button ref={actionButton} type="button" className="history-organizer-action-toggle" aria-label={`${copy.actions} ${row.displayTitle}`}
        aria-expanded={menuOpen} aria-controls={actionId} disabled={busy}
        onClick={() => {
          if (!menuOpen) {
            const button = actionButton.current?.getBoundingClientRect();
            if (button) {
              const above = window.innerHeight - button.bottom < 185;
              const available = above ? button.top - 8 : window.innerHeight - button.bottom - 8;
              setMenuPosition({
                ...(above ? { bottom: window.innerHeight - button.top + 4 } : { top: button.bottom + 4 }),
                right: Math.max(8, window.innerWidth - button.right),
                maxHeight: Math.max(80, Math.min(370, available)),
              });
            }
          }
          onMenuChange(!menuOpen);
          setMode("closed");
        }}><DotsThreeIcon size={20} aria-hidden="true" /></button>
    </div>
    {menuOpen && <div ref={actionPanel} id={actionId} className="history-organizer-row-actions" style={menuPosition}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (mode === "closed") close();
        else {
          setMode("closed");
          requestAnimationFrame(() => actionPanel.current?.querySelector<HTMLButtonElement>("button")?.focus());
        }
      }}>
      {mode === "closed" && <>
        <button disabled={!row.capabilities.rename || busy} onClick={() => { setTitle(row.displayTitle); setMode("rename"); }}>{copy.rename}</button>
        <button disabled={!row.capabilities.pin || busy} onClick={() => { void mutate({ action: "pin", pinned: !row.pinned }); }}>{row.pinned ? copy.unpin : copy.pin}</button>
        <button disabled={!row.capabilities.archive || busy} onClick={() => { void mutate({ action: "archive", archived: !row.archived }); }}>{row.archived ? copy.restore : copy.archive}</button>
        <button onClick={() => setMode("details")}>{copy.details}</button>
        <button className="history-organizer-danger" disabled={!row.capabilities.delete || busy} onClick={() => setMode("delete")}>{copy.delete}</button>
      </>}
      {mode === "rename" && <form className="history-organizer-editor" onSubmit={event => { event.preventDefault(); void mutate({ action: "rename", title: title.trim() }); }}>
        <label htmlFor={titleId}>{copy.titleLabel}</label>
        <input id={titleId} ref={titleInput} value={title} maxLength={240} disabled={busy} onChange={event => setTitle(event.target.value)} />
        <div><button type="submit" disabled={busy || !title.trim()}>{copy.save}</button><button type="button" disabled={busy} onClick={close}>{copy.cancel}</button></div>
      </form>}
      {mode === "details" && <div className="history-organizer-row-details">
        <dl><dt>{copy.projectPath}</dt><dd>{row.identity.kind === "native" ? row.identity.directory : copy.localRecord}</dd>
          <dt>{copy.sourceDetail}</dt><dd>{copy[row.source]}</dd><dt>{copy.updatedDetail}</dt><dd>{time.toLocaleString(language)}</dd></dl>
        <button onClick={close}>{copy.close}</button>
      </div>}
      {mode === "delete" && <div className="history-organizer-confirm" role="alertdialog" aria-labelledby={titleId} aria-describedby={`${titleId}-note`}>
        <strong id={titleId}>{copy.deleteTitle}</strong>
        <p>{row.displayTitle}</p>
        <p id={`${titleId}-note`}>{copy.deleteNote}</p>
        <label className="history-organizer-memory-option"><input type="checkbox" checked={forgetMemories} disabled={busy}
          onChange={event => setForgetMemories(event.target.checked)} />{copy.deleteMemories}</label>
        <div className="history-organizer-confirm-actions">
          <button ref={cancelButton} disabled={busy} onClick={close}>{copy.cancel}</button>
          <button className="history-organizer-danger" disabled={busy} onClick={() => { void mutate({ action: "delete", confirmed: true }); }}>{copy.deleteConfirm}</button>
        </div>
      </div>}
    </div>}
  </li>;
}
