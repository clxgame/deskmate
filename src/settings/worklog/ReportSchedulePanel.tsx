import { useEffect, useRef, useState } from "react";
import type { Dict } from "../../lib/i18n";
import { deleteSchedule, retryRun, saveSchedule, type Run, type RunState, type Schedule } from "../../lib/worklog";
import { TimePicker } from "../widgets/TimePicker";
import { DeleteConfirmation, WorklogFeedback } from "./WorklogFeedback";
import { useWorklogAction } from "./useWorklogAction";
import type { WorklogLabels } from "./worklogLabels";
const nextRunFormatter = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "longOffset" });

function runLabel(state: RunState, labels: WorklogLabels): string {
  switch (state) {
    case "queued": return labels.pending;
    case "running": return labels.running;
    case "succeeded": return labels.succeeded;
    case "no_material": return labels.noSources;
    case "retry_wait": return labels.retry;
    case "failed": return labels.runFailed;
    case "cancelled": return labels.cancelled;
  }
}
function ScheduleEditor({ schedule, labels, t, onDone }: {
  readonly schedule: Schedule | null; readonly labels: WorklogLabels; readonly t: Dict; readonly onDone: () => void;
}) {
  const [kind, setKind] = useState<"daily" | "weekly">(schedule?.kind === "daily" ? "daily" : "weekly");
  const [days, setDays] = useState<readonly number[]>(schedule?.weekdaySet ?? [5]);
  const [time, setTime] = useState(schedule?.localTime ?? "17:00");
  const action = useWorklogAction(labels);
  const dayLabels = [labels.monday, labels.tuesday, labels.wednesday, labels.thursday, labels.friday];
  return <form className="worklog-form worklog-item" onSubmit={(event) => {
    event.preventDefault();
    const draft = { id: schedule?.id ?? null, expectedRevision: schedule?.revision ?? null, kind, weekdaySet: days, localTime: time, enabled: schedule?.enabled ?? true };
    void action.run(JSON.stringify(draft), async (requestId) => { await saveSchedule({ requestId, ...draft }); onDone(); });
  }}>
    <label className="worklog-field">{labels.schedules}<select className="set-select" value={kind} disabled={action.busy} onChange={(event) => {
      const value = event.target.value;
      if (value !== "daily" && value !== "weekly") return;
      setKind(value);
      if (!schedule) { setDays(value === "daily" ? [1, 2, 3, 4, 5] : [5]); setTime(value === "daily" ? "18:00" : "17:00"); }
      else if (value === "weekly") setDays([days[0] ?? 5]);
    }}>
      <option value="daily">{labels.daily}</option><option value="weekly">{labels.weekly}</option>
    </select></label>
    <fieldset className="worklog-days" disabled={action.busy}><legend>{labels.weekday}</legend>{dayLabels.map((label, index) => <label key={label}>
      <input type={kind === "weekly" ? "radio" : "checkbox"} name={kind === "weekly" ? "worklog-weekday" : undefined} checked={days.includes(index + 1)} onChange={(event) => setDays(kind === "weekly" ? [index + 1] : event.target.checked ? [...days, index + 1].sort((a, b) => a - b) : days.filter((day) => day !== index + 1))} />{label}
    </label>)}</fieldset>
    <div className="worklog-field"><span>{labels.time}</span><TimePicker t={t} value={time} onChange={setTime} /></div>
    <p className="worklog-meta">{labels.timezone}: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
    <WorklogFeedback error={action.error} notice={action.notice} />
    <div className="worklog-actions"><button className="set-btn" type="submit" disabled={action.busy || !days.length}>{labels.save}</button><button className="set-btn" type="button" disabled={action.busy} onClick={onDone}>{labels.cancel}</button></div>
  </form>;
}
export function ReportSchedulePanel({ schedules, runs, targetId, targetRunId, labels, t, onChanged }: {
  readonly schedules: readonly Schedule[]; readonly runs: readonly Run[]; readonly targetId: string | null; readonly targetRunId?: string | null;
  readonly labels: WorklogLabels; readonly t: Dict; readonly onChanged: () => void;
}) {
  const targetRunRef = useRef<HTMLLIElement>(null);
  useEffect(() => { targetRunRef.current?.scrollIntoView({ block: "nearest" }); }, [targetRunId]);
  const [editing, setEditing] = useState<Schedule | "new" | null>(() => schedules.find((schedule) => schedule.id === targetId) ?? null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const action = useWorklogAction(labels);
  const dayLabels = [labels.monday, labels.tuesday, labels.wednesday, labels.thursday, labels.friday, labels.saturday, labels.sunday];
  return <div className="worklog-detail">
    <p className="worklog-meta">{labels.pausedHint}</p>
    <button className="set-btn" type="button" onClick={() => setEditing("new")}>{labels.addSchedule}</button>
    {editing && <ScheduleEditor key={typeof editing === "string" ? "new" : `${editing.id}:${editing.revision}`} schedule={typeof editing === "string" ? null : editing} labels={labels} t={t} onDone={() => { setEditing(null); onChanged(); }} />}
    <WorklogFeedback error={action.error} notice={action.notice} />
    <ul className="worklog-list">{schedules.map((schedule) => <li className="worklog-item" key={schedule.id}>
      <p>{schedule.kind === "daily" ? labels.daily : labels.weekly} · {schedule.weekdaySet.map((day) => dayLabels[day - 1]).join(" / ")} · {schedule.localTime}</p>
      <p className="worklog-meta">{schedule.enabled ? labels.enabled : labels.paused} · {labels.next}: {schedule.nextDueAt ? nextRunFormatter.format(new Date(schedule.nextDueAt)) : "—"}</p>
      <div className="worklog-actions"><button className="set-btn" type="button" disabled={action.busy} onClick={() => setEditing(schedule)}>{labels.edit}</button>
        <button className="set-btn" type="button" disabled={action.busy} onClick={() => {
          void action.run(`toggle:${schedule.id}:${schedule.revision}`, async (requestId) => { await saveSchedule({ requestId, id: schedule.id, expectedRevision: schedule.revision, kind: schedule.kind, weekdaySet: schedule.weekdaySet, localTime: schedule.localTime, enabled: !schedule.enabled }); onChanged(); });
        }}>{schedule.enabled ? labels.pause : labels.resume}</button>
        <button className="set-btn set-btn-danger" type="button" disabled={action.busy} onClick={() => setDeleting(schedule)}>{labels.remove}</button>
      </div>
    </li>)}</ul>
    {deleting && <DeleteConfirmation labels={labels} busy={action.busy} onCancel={() => setDeleting(null)} onConfirm={() => {
      void action.run(`delete:${deleting.id}`, async (requestId) => { await deleteSchedule({ requestId, id: deleting.id, expectedRevision: deleting.revision }); setDeleting(null); onChanged(); });
    }} />}
    <h3 className="worklog-heading">{labels.runs}</h3>
    {!runs.length && <p className="worklog-meta">{labels.noRuns}</p>}
    <ul className="worklog-list">{runs.map((run) => <li key={run.id} className="worklog-item" ref={run.id === targetRunId ? targetRunRef : undefined} aria-current={run.id === targetRunId ? "true" : undefined}>
      <p>{run.periodStart} — {run.periodEnd} · {runLabel(run.state, labels)}</p>
      {run.errorCode && <p className="worklog-error">{run.errorCode}</p>}
      {run.nextRetryAt && <p className="worklog-meta">{labels.next}: {nextRunFormatter.format(new Date(run.nextRetryAt))}</p>}
      {(run.state === "failed" || run.state === "no_material") && <button className="set-btn" type="button" disabled={action.busy} onClick={() => {
        void action.run(`retry:${run.id}`, async (requestId) => { await retryRun({ requestId, id: run.id }); onChanged(); return labels.queued; });
      }}>{labels.retry}</button>}
    </li>)}</ul>
  </div>;
}
