import { useId, useRef, useState } from "react";
import type { WorklogLabels } from "./worklogLabels";
import { weekLabel, type WorklogWeek } from "./worklogWeek";
import { useWeekWheel } from "./useWeekWheel";

interface WeekWheelProps {
  readonly weeks: readonly WorklogWeek[];
  readonly selected: WorklogWeek;
  readonly today: string;
  readonly current: WorklogWeek;
  readonly labels: WorklogLabels;
  readonly onChange: (week: WorklogWeek) => void;
  readonly onFinish: () => void;
}

export function WeekWheel({ weeks, selected, today, current, labels, onChange, onFinish }: WeekWheelProps) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [candidate, setCandidate] = useState(selected.number - 1);
  useWeekWheel({ listRef, weeks, selected, onChange, onFinish, onCandidate: setCandidate });
  return <div className="worklog-week-wheel">
    <div className="worklog-week-band" aria-hidden="true" />
    <div className="worklog-week-options" role="listbox" aria-label={labels.weekPicker}
      ref={listRef} tabIndex={0} aria-activedescendant={`${id}-${candidate}`}>
      {weeks.map((week, index) => <div id={`${id}-${index}`} key={week.start}
        role="option" aria-selected={candidate === index}
        aria-current={week.start === current.start ? "date" : undefined}
        className="worklog-week-option" data-period={week.start === current.start ? "current" : week.end < today ? "past" : "future"}>
        <span>{weekLabel(week, labels.weekFormat)}</span>
        {week.start === current.start && <span className="worklog-week-current">{labels.currentWeekMark}</span>}
      </div>)}
    </div>
  </div>;
}
