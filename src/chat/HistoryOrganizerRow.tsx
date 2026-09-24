import { useEffect, useId, useRef, useState } from "react";
import type { CatalogMutation, UnifiedHistoryRow } from "../lib/unifiedHistory";
import { readOnlyLabel, type HistoryCopy } from "./historyOrganizerCopy";

interface RowProps {
  readonly row: UnifiedHistoryRow;
  readonly copy: HistoryCopy;
  readonly language: string;
  readonly busy: boolean;
  readonly onOpen: (row: UnifiedHistoryRow) => void;
  readonly onMutate: (row: UnifiedHistoryRow, mutation: CatalogMutation, forgetMemories?: boolean) => Promise<boolean>;
}
export function HistoryOrganizerRow({ row, copy, language, busy, onOpen, onMutate }: RowProps) {
  const [mode, setMode] = useState<"closed" | "actions" | "rename" | "delete">("closed");
  const [title, setTitle] = useState(row.displayTitle);
  const [forgetMemories, setForgetMemories] = useState(true);
  const availabilityLabel = row.availability === "available" ? null : copy[row.availability];
  const readOnly = row.capabilities.send ? null : readOnlyLabel(row.capabilities.readOnlyReason, copy);
  const actionId = useId();
  const titleId = useId();
  const actionButton = useRef<HTMLButtonElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mode === "rename") titleInput.current?.focus();
    if (mode === "delete") cancelButton.current?.focus();
  }, [mode]);
  const close = () => { setMode("closed"); actionButton.current?.focus(); };
  const mutate = async (mutation: CatalogMutation) => {
    if (await onMutate(row, mutation, forgetMemories)) close();
  };
  return <li className="history-organizer-row">
    <div className="history-organizer-row-main">
      <button className="history-organizer-open" disabled={!row.capabilities.open || busy}
        aria-label={`${copy.open} ${row.displayTitle}`} onClick={() => onOpen(row)}>
        <span className="history-organizer-row-title">{row.displayTitle}</span>
        <span className="history-organizer-meta">{row.identity.kind === "native" ? row.identity.directory : copy.localRecord}</span>
        <span className="history-organizer-meta">{copy[row.source]} · <time dateTime={new Date(row.updated).toISOString()}>{new Date(row.updated).toLocaleString(language)}</time></span>
      </button>
      <button ref={actionButton} className="history-organizer-action-toggle" aria-label={`${copy.actions} ${row.displayTitle}`}
        aria-expanded={mode !== "closed"} aria-controls={actionId} disabled={busy}
        onClick={() => setMode(mode === "closed" ? "actions" : "closed")}>{copy.actions}</button>
    </div>
    <div className="history-organizer-badges">
      {row.pinned && <span className="history-organizer-accent">{copy.pinned}</span>}
      {availabilityLabel && <span className="history-organizer-warning">{availabilityLabel}</span>}
      {readOnly && readOnly !== availabilityLabel && <span>{readOnly}</span>}
    </div>
    {mode !== "closed" && <div id={actionId} className="history-organizer-row-actions" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      {mode === "actions" && <>
        <button disabled={!row.capabilities.rename || busy} onClick={() => { setTitle(row.displayTitle); setMode("rename"); }}>{copy.rename}</button>
        <button disabled={!row.capabilities.pin || busy} onClick={() => { void mutate({ action: "pin", pinned: !row.pinned }); }}>{row.pinned ? copy.unpin : copy.pin}</button>
        <button disabled={!row.capabilities.archive || busy} onClick={() => { void mutate({ action: "archive", archived: !row.archived }); }}>{row.archived ? copy.restore : copy.archive}</button>
        <button className="history-organizer-danger" disabled={!row.capabilities.delete || busy} onClick={() => setMode("delete")}>{copy.delete}</button>
      </>}
      {mode === "rename" && <form className="history-organizer-editor" onSubmit={event => { event.preventDefault(); void mutate({ action: "rename", title: title.trim() }); }}>
        <label htmlFor={titleId}>{copy.titleLabel}</label>
        <input id={titleId} ref={titleInput} value={title} maxLength={240}
          disabled={busy} onChange={event => setTitle(event.target.value)} />
        <button type="submit" disabled={busy || !title.trim()}>{copy.save}</button>
        <button type="button" disabled={busy} onClick={close}>{copy.cancel}</button>
      </form>}
      {mode === "delete" && <div className="history-organizer-confirm" role="alertdialog" aria-labelledby={titleId} aria-describedby={`${titleId}-note`}>
        <strong id={titleId}>{copy.deleteTitle}</strong>
        <p>{row.displayTitle}</p>
        <p id={`${titleId}-note`}>{copy.deleteNote}</p>
        <label className="history-organizer-memory-option">
          <input type="checkbox" checked={forgetMemories} disabled={busy} onChange={event => setForgetMemories(event.target.checked)} />
          {copy.deleteMemories}
        </label>
        <div className="history-organizer-confirm-actions">
          <button ref={cancelButton} disabled={busy} onClick={close}>{copy.cancel}</button>
          <button className="history-organizer-danger" disabled={busy} onClick={() => { void mutate({ action: "delete", confirmed: true }); }}>{copy.deleteConfirm}</button>
        </div>
      </div>}
    </div>}
  </li>;
}


