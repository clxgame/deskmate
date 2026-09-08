import { Activity, useId, useState } from "react";
import { AppIcon } from "../../ui/AppIcon";
import { Row, Switch, type TabProps } from "../settingsPrimitives";
import { PomodoroWidget } from "./PomodoroWidget";
import { ScheduledTasksWidget, type ScheduledTaskDraft } from "./ScheduledTasksWidget";
import { WorklogTab, type WorklogTarget } from "../worklog/WorklogTab";
import { worklogLabels } from "../worklog/worklogLabels";
import "./widgets.css";

export type WidgetId = "tasks" | "pomodoro" | "worklog";
interface WidgetTabProps extends TabProps {
  readonly activeWidget: WidgetId;
  readonly onSelect: (widget: WidgetId) => void;
  readonly worklogRequest: { readonly target: WorklogTarget | null; readonly id: number } | null;
}
export function WidgetTab({ settings, patch, t, activeWidget, onSelect, worklogRequest }: WidgetTabProps) {
  const [worklogVisited, setWorklogVisited] = useState(activeWidget === "worklog");
  if (activeWidget === "worklog" && !worklogVisited) setWorklogVisited(true);
  const [draft, setDraft] = useState<ScheduledTaskDraft>({ time: "09:00", prompt: "" });
  const panelId = useId();
  const panels = {
    tasks: <ScheduledTasksWidget settings={settings} patch={patch} t={t}
      draft={draft} onDraftChange={setDraft} />,
    pomodoro: <PomodoroWidget settings={settings} patch={patch} t={t} />,
  };
  return (
    <div className="set-widgets">
      <Row label={t.alwaysOnTop}>
        <Switch label={t.alwaysOnTop} checked={settings.alwaysOnTop}
          onChange={(value) => patch("alwaysOnTop", value)} />
      </Row>
      <div className="set-widget-selectors" role="group" aria-label={t.widgetSelector}>
        <button type="button" className="set-widget-tile" id={`${panelId}-tasks`}
          aria-pressed={activeWidget === "tasks"} aria-controls={panelId}
          onClick={() => onSelect("tasks")}>
          <AppIcon name="clock" size={32} /><span>{t.scheduledTasks}</span>
        </button>
        <button type="button" className="set-widget-tile" id={`${panelId}-pomodoro`}
          aria-pressed={activeWidget === "pomodoro"} aria-controls={panelId}
          onClick={() => onSelect("pomodoro")}>
          <AppIcon name="timer" size={32} /><span>{t.pomodoroTitle}</span>
        </button>
        <button type="button" className="set-widget-tile" id={`${panelId}-worklog`}
          aria-pressed={activeWidget === "worklog"} aria-controls={panelId}
          onClick={() => onSelect("worklog")}>
          <AppIcon name="history" size={32} /><span>{worklogLabels(settings.language).featureTitle}</span>
        </button>
      </div>
      <section className="set-widget-panel" id={panelId}
        aria-labelledby={`${panelId}-${activeWidget}`}>
        {activeWidget !== "worklog" && panels[activeWidget]}
        {worklogVisited && <Activity mode={activeWidget === "worklog" ? "visible" : "hidden"}>
          <WorklogTab language={settings.language} t={t} target={worklogRequest?.target} targetRequestId={worklogRequest?.id} />
        </Activity>}
      </section>
    </div>
  );
}
