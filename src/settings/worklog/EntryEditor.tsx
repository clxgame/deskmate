import { useState } from "react";
import { deleteEntry, recordEntry, updateEntry, type Entry, type EntryStatus } from "../../lib/worklog";
import { DeleteConfirmation, WorklogFeedback } from "./WorklogFeedback";
import { useWorklogAction } from "./useWorklogAction";
import type { WorklogLabels } from "./worklogLabels";

export function EntryEditor({ entry, date, labels, onBack, onChanged, onReload }: {
  readonly entry: Entry | null; readonly date: string; readonly labels: WorklogLabels;
  readonly onBack: () => void; readonly onChanged: () => void; readonly onReload: () => void;
}) {
  const [text, setText] = useState(entry?.text ?? "");
  const [businessDate, setDate] = useState(entry?.businessDate ?? date);
  const [project, setProject] = useState(entry?.project ?? "");
  const [status, setStatus] = useState<EntryStatus>(entry?.status ?? "done");
  const [confirm, setConfirm] = useState(false);
  const [linked, setLinked] = useState(false);
  const action = useWorklogAction(labels);
  const draft = { businessDate, project: project.trim() || null, text: text.trim(), status };
  async function save() {
    const ok = await action.run(JSON.stringify(draft), async (requestId) => {
      if (entry) await updateEntry({ ...draft, requestId, id: entry.id, expectedRevision: entry.revision });
      else await recordEntry({ ...draft, requestId, originalText: text, sourceSessionId: null, sourceMessageId: null });
    });
    if (ok) { onChanged(); onBack(); }
  }
  return <div className="worklog-detail"><button className="set-btn" type="button" onClick={onBack} disabled={action.busy}>{labels.back}</button>
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="worklog-form">
      <div className="worklog-filters"><label className="worklog-field">{labels.date}<input className="set-input" type="date" required value={businessDate} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="worklog-field">{labels.project}<input className="set-input" value={project} maxLength={120} onChange={(e) => setProject(e.target.value)} /></label></div>
      <label className="worklog-field">{labels.status}<select className="set-select" value={status} onChange={(e) => { const value = e.target.value; if (value === "done" || value === "in_progress" || value === "blocked" || value === "planned") setStatus(value); }}>
        <option value="done">{labels.done}</option><option value="in_progress">{labels.progress}</option><option value="blocked">{labels.blocked}</option><option value="planned">{labels.planned}</option>
      </select></label>
      <label className="worklog-field">{labels.content}<textarea className="set-input worklog-textarea" required value={text} maxLength={8000} rows={7} onChange={(e) => setText(e.target.value)} /></label>
      <WorklogFeedback error={action.error} notice={action.notice} />
      <div className="worklog-actions"><button className="set-btn" type="submit" disabled={action.busy || !text.trim()}>{action.busy ? labels.working : labels.save}</button>
        {entry && <button className="set-btn" type="button" disabled={action.busy} onClick={onReload}>{labels.reload}</button>}
        {entry && <button className="set-btn set-btn-danger" type="button" disabled={action.busy} onClick={() => setConfirm(true)}>{labels.remove}</button>}
      </div>
    </form>
    {confirm && entry && <DeleteConfirmation labels={labels} busy={action.busy} linked={linked} onLinkedChange={setLinked} onCancel={() => setConfirm(false)} onConfirm={() => {
      void action.run(`delete:${entry.id}:${linked}`, async (requestId) => { await deleteEntry({ requestId, id: entry.id, expectedRevision: entry.revision, deleteLinkedReports: linked }); onChanged(); onBack(); });
    }} />}
  </div>;
}
