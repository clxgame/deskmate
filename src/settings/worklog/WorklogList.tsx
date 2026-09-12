import type { Entry, Report } from "../../lib/worklog";
import type { WorklogLabels } from "./worklogLabels";
import { weekForDate, weekLabel } from "./worklogWeek";
export function WorklogList({ entries, reports, labels, onEntry, onReport }: {
  readonly entries: readonly Entry[]; readonly reports: readonly Report[]; readonly labels: WorklogLabels;
  readonly onEntry: (entry: Entry) => void; readonly onReport: (report: Report) => void;
}) {
  if (!entries.length && !reports.length) return <p className="worklog-meta">{labels.empty}</p>;
  return <ul className="worklog-list">
    {entries.map((entry) => <li className="worklog-item" key={entry.id}><button type="button" className="worklog-open" onClick={() => onEntry(entry)}>
      <span>{entry.text}</span><span className="worklog-meta">{[entry.businessDate, entry.project, entry.status === "done" ? labels.done : entry.status === "in_progress" ? labels.progress : entry.status === "blocked" ? labels.blocked : labels.planned].filter(Boolean).join(" · ")}</span>
    </button></li>)}
    {reports.map((report) => <li className="worklog-item" key={report.id}><button className="worklog-open" type="button" onClick={() => onReport(report)}>
      <span>{report.kind === "daily" ? `${labels.daily} · ${report.periodStart}` : weekLabel(weekForDate(report.periodStart), labels.weekFormat)}</span>
      <span className={report.stale ? "worklog-warning" : "worklog-meta"}>{report.stale ? labels.stale : labels.current} · r{report.revision}</span>
    </button></li>)}
  </ul>;
}
