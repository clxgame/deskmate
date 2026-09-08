import { useState } from "react";
import { applyReportVersion, deleteReport, saveReport, type ReportDetail, type ReportKind, type ReportVersion } from "../../lib/worklog";
import { DeleteConfirmation, WorklogFeedback } from "./WorklogFeedback";
import { copyReport, exportReport } from "./reportExport";
import { useWorklogAction } from "./useWorklogAction";
import type { WorklogLabels } from "./worklogLabels";

export function missingReportDates(start: string, end: string, coverage: readonly string[]): readonly string[] {
  const missing: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= end) {
    const day = cursor.toISOString().slice(0, 10);
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6 && !coverage.includes(day)) missing.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return missing;
}

function ReportSources({ detail, version, labels }: { readonly detail: ReportDetail; readonly version: ReportVersion; readonly labels: WorklogLabels }) {
  const missing = missingReportDates(detail.report.periodStart, detail.report.periodEnd, version.coverageDates);
  return <details><summary>{labels.sources} · {version.sourceSnapshot.length}</summary>
    {missing.length > 0 && <p className="worklog-warning">{labels.missing}: {missing.join(", ")}</p>}
    <ul className="worklog-list">{version.sourceSnapshot.map((source) => <li className="worklog-item" key={`${source.source.kind}:${source.source.id}`}>
      <p className="worklog-meta">{[source.businessDate, source.project, source.source.id, `r${source.source.revision}`].filter(Boolean).join(" · ")}</p><p className="worklog-source-text">{source.text}</p>
    </li>)}</ul>
  </details>;
}

export function ReportEditor({ detail, kind, start, end, labels, onBack, onChanged, onReload }: {
  readonly detail: ReportDetail | null; readonly kind: ReportKind; readonly start: string; readonly end: string;
  readonly labels: WorklogLabels; readonly onBack: () => void; readonly onChanged: () => void; readonly onReload: () => void;
}) {
  const initial = detail?.versions.find((version) => version.id === detail.report.currentVersionId) ?? detail?.versions[0];
  const [selectedId, setSelectedId] = useState(initial?.id ?? "");
  const [body, setBody] = useState(initial?.bodyMarkdown ?? "");
  const [confirm, setConfirm] = useState(false);
  const action = useWorklogAction(labels);
  const version = detail?.versions.find((item) => item.id === selectedId);
  const report = detail?.report;
  const edited = body !== (version?.bodyMarkdown ?? "");
  async function save() {
    const draft = { kind: report?.kind ?? kind, periodStart: report?.periodStart ?? start, periodEnd: report?.periodEnd ?? end, expectedRevision: report?.revision ?? null, bodyMarkdown: body };
    if (await action.run(JSON.stringify(draft), async (requestId) => { await saveReport({ requestId, ...draft }); })) { onChanged(); onReload(); }
  }
  return <div className="worklog-detail"><button className="set-btn" type="button" disabled={action.busy} onClick={onBack}>{labels.back}</button>
    <p className="worklog-meta">{report?.periodStart ?? start} — {report?.periodEnd ?? end}</p>
    {report?.stale && <p className="worklog-warning" role="status">{labels.stale}</p>}
    {detail && <label className="worklog-field">{labels.version}<select className="set-select" value={selectedId} disabled={action.busy || edited} onChange={(e) => {
      const selected = detail.versions.find((item) => item.id === e.target.value);
      if (selected) { setSelectedId(selected.id); setBody(selected.bodyMarkdown); }
    }}>{detail.versions.map((item) => <option key={item.id} value={item.id}>{item.version} · {item.id === report?.currentVersionId ? labels.current : item.origin === "generated" ? labels.candidate : labels.edit} · {item.generatedAt}</option>)}</select></label>}
    <form className="worklog-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="worklog-field">{labels.content}<textarea className="set-input worklog-textarea" rows={10} value={body} maxLength={20000} required onChange={(e) => setBody(e.target.value)} /></label>
      <div className="worklog-actions"><button className="set-btn" type="submit" disabled={action.busy || !body.trim()}>{action.busy ? labels.working : labels.save}</button>
        {report && <button className="set-btn" type="button" disabled={action.busy} onClick={onReload}>{labels.reload}</button>}
        {report && version && version.id !== report.currentVersionId && <button className="set-btn" type="button" disabled={action.busy || edited} onClick={() => {
          void action.run(`apply:${version.id}:${report.revision}`, async (requestId) => { await applyReportVersion({ requestId, reportId: report.id, versionId: version.id, expectedRevision: report.revision }); onChanged(); onReload(); });
        }}>{labels.apply}</button>}
      </div>
    </form>
    <WorklogFeedback error={action.error} notice={action.notice} />
    {report && version && <><div className="worklog-actions">
      <button className="set-btn" type="button" disabled={action.busy || edited} onClick={() => { void action.run("copy", async () => { await copyReport(version.bodyMarkdown); return labels.copied; }); }}>{labels.copy}</button>
      {(["markdown", "text"] as const).map((format) => <button className="set-btn" type="button" key={format} disabled={action.busy || edited} onClick={() => {
        void action.run(`export:${version.id}:${format}`, async () => { const receipt = await exportReport(report.id, version.id, format); return `${labels.exported} ${receipt.fileName}`; });
      }}>{format === "markdown" ? labels.exportMd : labels.exportTxt}</button>)}
      <button className="set-btn set-btn-danger" type="button" disabled={action.busy} onClick={() => setConfirm(true)}>{labels.remove}</button>
    </div><ReportSources detail={detail} version={version} labels={labels} /></>}
    {confirm && report && <DeleteConfirmation labels={labels} busy={action.busy} onCancel={() => setConfirm(false)} onConfirm={() => {
      void action.run(`delete:${report.id}`, async (requestId) => { await deleteReport({ requestId, id: report.id, expectedRevision: report.revision }); onChanged(); onBack(); });
    }} />}
  </div>;
}
