import type { WorklogLabels } from "./worklogLabels";
export function WorklogFeedback({ error, notice }: { readonly error: string | null; readonly notice: string | null }) {
  return <>{error && <p className="worklog-error" role="alert">{error}</p>}{notice && <p className="worklog-meta" role="status">{notice}</p>}</>;
}
export function DeleteConfirmation({ labels, busy, linked, onLinkedChange, onCancel, onConfirm }: {
  readonly labels: WorklogLabels; readonly busy: boolean; readonly linked?: boolean;
  readonly onLinkedChange?: (value: boolean) => void; readonly onCancel: () => void; readonly onConfirm: () => void;
}) {
  return <div className="worklog-confirm" role="group" aria-label={labels.confirm}>
    <p>{labels.deleteQuestion}</p>
    {onLinkedChange && <label className="worklog-field">{labels.linked}<select className="set-select" value={linked ? "delete" : "keep"} onChange={(e) => onLinkedChange(e.target.value === "delete")} disabled={busy}>
      <option value="keep">{labels.keepReports}</option><option value="delete">{labels.deleteReports}</option>
    </select></label>}
    <div className="worklog-actions"><button className="set-btn set-btn-danger" type="button" disabled={busy} onClick={onConfirm}>{labels.confirm}</button><button className="set-btn" type="button" disabled={busy} onClick={onCancel}>{labels.cancel}</button></div>
  </div>;
}
