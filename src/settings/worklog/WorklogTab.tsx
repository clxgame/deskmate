import { localWorklogDate as today } from "../../lib/worklogDate";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dict } from "../../lib/i18n";
import { getSettings } from "../../lib/settings";
import { asWorklogError, generateReport, getReport, listReports, listRuns, listSchedules, onWorklogChanged, queryEntries, type Entry, type Report, type ReportDetail, type Run, type Schedule } from "../../lib/worklog";
import { EntryEditor } from "./EntryEditor";
import { ReportEditor } from "./ReportEditor";
import { ReportSchedulePanel } from "./ReportSchedulePanel";
import { WorklogFeedback } from "./WorklogFeedback";
import { RangeDelete } from "./RangeDelete";
import { WorklogList } from "./WorklogList";
import { useWorklogAction } from "./useWorklogAction";
import { worklogLabels } from "./worklogLabels";
import { WeekPicker } from "./WeekPicker";
import { weekForDate } from "./worklogWeek";
import "./worklog.css";

export interface WorklogTarget { readonly kind: "entry" | "report" | "schedule" | "run"; readonly id: string }
export interface WorklogTabProps { readonly language: string; readonly t: Dict; readonly target?: WorklogTarget | null; readonly targetRequestId?: number }
type View = "daily" | "weekly" | "schedules";
type Detail = { readonly kind: "entry"; readonly entry: Entry | null } | { readonly kind: "report"; readonly detail: ReportDetail | null } | null;
type Data = { readonly entries: readonly Entry[]; readonly reports: readonly Report[]; readonly schedules: readonly Schedule[]; readonly runs: readonly Run[] };

export function WorklogTab({ language, t, target, targetRequestId }: WorklogTabProps) {
  const labels = worklogLabels(language);
  const [view, setView] = useState<View>("daily");
  const [day, setDay] = useState(today);
  const [week, setWeek] = useState(() => weekForDate(today()));
  const start = view === "weekly" ? week.start : day;
  const end = view === "weekly" ? week.end : day;
  const [project, setProject] = useState("");
  const [data, setData] = useState<Data>({ entries: [], reports: [], schedules: [], runs: [] });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [targetState, setTargetState] = useState<{ readonly failure: string | null; readonly retry: number; readonly scheduleId: string | null; readonly runId: string | null }>({ failure: null, retry: 0, scheduleId: null, runId: null });
  const { failure: targetFailure, retry: targetRetry, scheduleId: scheduleTarget, runId: runTarget } = targetState;
  const [detail, setDetail] = useState<Detail>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [clear, setClear] = useState<readonly Entry[] | null>(null);
  const sequence = useRef(0);
  const consumedTarget = useRef<{ readonly target: WorklogTarget | null; readonly id: number | undefined; readonly retry: number } | null>(null);
  const action = useWorklogAction(labels);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setLoaded(false); setFailure(null);
    try {
      const query = { start, end, project: project.trim() || null };
      const [entries, reports, schedules, runs] = await Promise.all([queryEntries(query), listReports(query), listSchedules(), listRuns()]);
      if (current === sequence.current) { setData({ entries, reports, schedules, runs }); setLoaded(true); }
    } catch (error) { const code = error instanceof Error ? error.name : asWorklogError(error).code; if (current === sequence.current) setFailure(code); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [start, end, project]);
  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [load]);
  useEffect(() => {
    const subscription = onWorklogChanged(() => { void load(); });
    void subscription.catch((error: unknown) => { setFailure(error instanceof Error ? error.name : asWorklogError(error).code); });
    return () => { void subscription.then((unlisten) => unlisten(), () => undefined); };
  }, [load]);
  useEffect(() => {
    if (target === undefined || (consumedTarget.current?.target === target && consumedTarget.current.id === targetRequestId && consumedTarget.current.retry === targetRetry)) return;
    let cancelled = false;
    setDetail(null); setClear(null); setTargetState((current) => ({ ...current, failure: null, scheduleId: null, runId: null }));
    setEditorEpoch((epoch) => epoch + 1);
    async function openTarget() {
      if (target === undefined) return;
      try {
        if (target === null) { setView("daily"); setDay(today()); }
        else switch (target.kind) {
          case "run": {
            const runs = await listRuns();
            if (!cancelled) {
              setView("schedules"); setData((current) => ({ ...current, runs }));
              setTargetState((current) => ({ ...current, runId: target.id }));
            }
            break;
          }
          case "schedule": {
            const schedules = await listSchedules();
            if (!cancelled) {
              setView("schedules"); setData((current) => ({ ...current, schedules }));
              if (schedules.some((schedule) => schedule.id === target.id)) setTargetState((current) => ({ ...current, scheduleId: target.id }));
              else setTargetState((current) => ({ ...current, failure: "NOT_FOUND" }));
            }
            break;
          }
          case "report": {
            const report = await getReport(target.id);
            if (!cancelled) { setView(report.report.kind === "weekly" ? "weekly" : "daily"); setDay(report.report.periodStart); setWeek(weekForDate(report.report.periodStart)); setDetail({ kind: "report", detail: report }); }
            break;
          }
          case "entry": {
            const records = await queryEntries({ start: "0001-01-01", end: "9999-12-31", project: null });
            const entry = records.find((item) => item.id === target.id);
            if (!cancelled) { setView("daily"); if (entry) { setDay(entry.businessDate); setDetail({ kind: "entry", entry }); } else setTargetState((current) => ({ ...current, failure: "NOT_FOUND" })); }
            break;
          }
        }
      } catch (error) { const code = error instanceof Error ? error.name : asWorklogError(error).code; if (!cancelled) setTargetState((current) => ({ ...current, failure: code })); }
      if (!cancelled) consumedTarget.current = { target, id: targetRequestId, retry: targetRetry };
    }
    void openTarget(); return () => { cancelled = true; };
  }, [target, targetRequestId, targetRetry]);
  async function openReport(report: Report) { await action.run(`open:${report.id}`, async () => { setDetail({ kind: "report", detail: await getReport(report.id) }); return ""; }); }
  async function reloadDetail() {
    if (!detail) return;
    await action.run("reload", async () => {
      switch (detail.kind) {
        case "entry": {
          if (!detail.entry) { setDetail(null); break; }
          const records = await queryEntries({ start: "0001-01-01", end: "9999-12-31", project: null });
          const entry = records.find((record) => record.id === detail.entry?.id);
          setDetail(entry ? { kind: "entry", entry } : null); break;
        }
        case "report": setDetail(detail.detail ? { kind: "report", detail: await getReport(detail.detail.report.id) } : null); break;
      }
      setEditorEpoch((epoch) => epoch + 1);
      return "";
    });
  }
  const back = () => setDetail(null);
  const changed = () => { void load(); };
  const selectView = (next: View) => {
    setView(next); setClear(null);
    setTargetState((current) => ({ ...current, failure: null, scheduleId: null, runId: null }));
  };
  const taskDate = today() >= start && today() <= end ? today() : start;
  const reports = data.reports.filter((report) => report.kind === view);
  return <div className="worklog">
    {!detail && <div className="worklog-toolbar"><div className="worklog-nav" role="group" aria-label={labels.featureTitle}>{(["daily", "weekly"] as const).map((item) => <button className="set-btn" type="button" key={item} aria-pressed={view === item} onClick={() => selectView(item)}>{labels[item]}</button>)}</div>
      <button className="set-btn worklog-schedule-link" type="button" aria-pressed={view === "schedules"} onClick={() => selectView("schedules")}>{labels.schedules}</button></div>}
    <p className="worklog-meta">{labels.dayBoundaryHint}</p>
    <WorklogFeedback error={action.error} notice={detail ? null : action.notice} />
    {detail?.kind === "entry" && <EntryEditor key={`entry:${editorEpoch}:${detail.entry?.id ?? "new"}`} entry={detail.entry} date={taskDate} labels={labels} onBack={back} onChanged={changed} onReload={() => { void reloadDetail(); }} />}
    {detail?.kind === "report" && <ReportEditor key={`report:${editorEpoch}:${detail.detail?.report.id ?? "new"}`} detail={detail.detail} kind={view === "weekly" ? "weekly" : "daily"} start={start} end={end} labels={labels} onBack={back} onChanged={changed} onReload={() => { void reloadDetail(); }} />}
    {!detail && <>
      {view !== "schedules" && <><div className="worklog-filters">
        {view === "weekly" ? <WeekPicker date={start} today={today()} labels={labels} onChange={(next) => { setWeek(next); setClear(null); }} /> : <label className="worklog-field">{labels.date}<input className="set-input" type="date" value={day} onChange={(event) => { if (event.target.value) { setDay(event.target.value); setClear(null); } }} /></label>}
        <label className="worklog-field">{labels.project}<input className="set-input" value={project} placeholder={labels.allProjects} onChange={(event) => setProject(event.target.value)} /></label>
      </div><div className="worklog-actions">
          <button className="set-btn" type="button" disabled={action.busy} onClick={() => {
            const kind = view === "daily" ? "daily" : "weekly";
            void action.run(`generate:${kind}:${start}:${end}`, async (requestId) => { const settings = await getSettings(); await generateReport({ requestId, kind, periodStart: kind === "daily" ? end : start, periodEnd: end, modelId: settings.modelId }); changed(); return labels.queued; });
          }}>{labels.generate}</button>
          {view === "daily" && <button className="set-btn" type="button" onClick={() => setDetail({ kind: "report", detail: null })}>{labels.dailyImport}</button>}
        <button className="set-btn" type="button" onClick={changed} disabled={loading}>{labels.refresh}</button>
      </div>{(view === "daily" || view === "weekly") && <p className="worklog-meta">{labels.generate} · {view === "daily" ? end : `${start} — ${end}`}</p>}</>}
      {loading && <p className="worklog-meta" role="status">{labels.loading}</p>}
      {targetFailure && <div><p className="worklog-error" role="alert">{labels.failed}</p><button className="set-btn" type="button" onClick={() => setTargetState((current) => ({ ...current, retry: current.retry + 1 }))}>{labels.retry}</button></div>}
      {failure && <div><p className="worklog-error" role="alert">{labels.failed}</p><button className="set-btn" type="button" onClick={changed}>{labels.retry}</button></div>}
      {loaded && (view === "schedules" ? <ReportSchedulePanel key={`schedules:${editorEpoch}:${scheduleTarget ?? "list"}`} schedules={data.schedules} runs={data.runs} targetId={scheduleTarget} targetRunId={runTarget} labels={labels} t={t} onChanged={changed} /> : reports.length ? <WorklogList entries={[]} reports={reports} labels={labels} onEntry={(entry) => setDetail({ kind: "entry", entry })} onReport={(report) => { void openReport(report); }} /> : <p className="worklog-meta">{labels.noReports}</p>)}
    </>}
    {view !== "schedules" && (!detail || detail.kind === "report") && <section className="worklog-tasks" aria-label={labels.entries}>
      <h3 className="worklog-heading">{labels.entries}</h3>
      <div className="worklog-actions"><button className="set-btn" type="button" onClick={() => setDetail({ kind: "entry", entry: null })}>{labels.add}</button>
        {loaded && data.entries.length > 0 && <button className="set-btn set-btn-danger" type="button" onClick={() => setClear(data.entries)}>{labels.clearRange}</button>}</div>
      {loaded && <WorklogList entries={data.entries} reports={[]} labels={labels} onEntry={(entry) => setDetail({ kind: "entry", entry })} onReport={(report) => { void openReport(report); }} />}
      {clear && <RangeDelete entries={clear} labels={labels} onChanged={changed} onClose={() => setClear(null)} />}
    </section>}
  </div>;
}
