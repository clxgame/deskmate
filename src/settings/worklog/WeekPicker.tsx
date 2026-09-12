import { useRef } from "react";
import { weekForDate, weekLabel, weeksForYear, type WorklogWeek } from "./worklogWeek";
import type { WorklogLabels } from "./worklogLabels";

export function WeekPicker({ date, today, labels, onChange }: {
  readonly date: string; readonly today: string; readonly labels: WorklogLabels;
  readonly onChange: (week: WorklogWeek) => void;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const selected = weekForDate(date);
  const current = weekForDate(today);
  const choose = (week: WorklogWeek) => {
    onChange(week);
    if (disclosure.current) disclosure.current.open = false;
  };
  return <details className="worklog-week-picker" ref={disclosure} onToggle={() => {
    if (disclosure.current?.open) selectedButton.current?.scrollIntoView?.({ block: "nearest" });
  }}>
    <summary className="set-btn">{selected.year} · {weekLabel(selected, labels.weekFormat)}</summary>
    <div className="worklog-week-panel">
      <div className="worklog-actions">
        <button type="button" className="set-btn" disabled={selected.year <= 2} onClick={() => onChange(weekForDate(`${selected.year - 1}-01-04`))}>{labels.previousYear}</button>
        <span>{selected.year}</span>
        <button type="button" className="set-btn" disabled={selected.year >= 9998} onClick={() => onChange(weekForDate(`${selected.year + 1}-01-04`))}>{labels.nextYear}</button>
        <button type="button" className="set-btn" onClick={() => choose(current)}>{labels.currentWeek}</button>
      </div>
      <div className="worklog-week-options" role="group" aria-label={labels.weekly}>
        {weeksForYear(selected.year).map((week) => <button type="button" key={week.start}
          ref={week.start === selected.start ? selectedButton : undefined}
          className="set-btn worklog-week-option" data-period={week.start === current.start ? "current" : week.end < today ? "past" : "future"}
          aria-current={week.start === current.start ? "date" : undefined} aria-pressed={week.start === selected.start}
          onClick={() => choose(week)}>{weekLabel(week, labels.weekFormat)}</button>)}
      </div>
    </div>
  </details>;
}
