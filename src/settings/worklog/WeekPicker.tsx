import { useEffect, useMemo, useRef, useState } from "react";
import { weekForDate, weekLabel, weeksForYear, type WorklogWeek } from "./worklogWeek";
import type { WorklogLabels } from "./worklogLabels";
import { WeekWheel } from "./WeekWheel";

export function WeekPicker({ date, today, labels, onChange }: {
  readonly date: string; readonly today: string; readonly labels: WorklogLabels;
  readonly onChange: (week: WorklogWeek) => void;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [navigation, setNavigation] = useState(0);
  const selected = weekForDate(date);
  const current = weekForDate(today);
  const weeks = useMemo(() => weeksForYear(selected.year), [selected.year]);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [open]);
  const choose = (week: WorklogWeek) => {
    setNavigation((value) => value + 1);
    if (week.start !== selected.start) onChange(week);
  };
  const changeYear = (year: number) => {
    const options = weeksForYear(year);
    const next = options[Math.min(selected.number, options.length) - 1];
    if (next) choose(next);
  };
  return <details className="worklog-week-picker" ref={disclosure} open={open} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); close(true); }
  }}>
    <summary className="set-btn" ref={trigger} aria-expanded={open}
      onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}>
      {selected.year} · {weekLabel(selected, labels.weekFormat)}
    </summary>
    {open && <div className="worklog-week-panel">
      <div className="worklog-actions">
        <button type="button" className="set-btn" disabled={selected.year <= 2} onClick={() => changeYear(selected.year - 1)}>{labels.previousYear}</button>
        <span>{selected.year}</span>
        <button type="button" className="set-btn" disabled={selected.year >= 9998} onClick={() => changeYear(selected.year + 1)}>{labels.nextYear}</button>
        <button type="button" className="set-btn" onClick={() => choose(current)}>{labels.currentWeek}</button>
      </div>
      <WeekWheel key={`${selected.year}-${navigation}`} weeks={weeks} selected={selected} today={today}
        current={current} labels={labels} onChange={onChange} onFinish={() => close(true)} />
    </div>}
  </details>;
}
