import { useId, useState } from "react";
import { AppIcon } from "../../ui/AppIcon";
import { Row, Switch, type TabProps } from "../settingsPrimitives";
import { PomodoroWidget } from "./PomodoroWidget";
import { ScheduledTasksWidget, type ScheduledTaskDraft } from "./ScheduledTasksWidget";
import "./widgets.css";

export function WidgetTab({ settings, patch, t }: TabProps) {
  const [activeWidget, setActiveWidget] = useState<"tasks" | "pomodoro">("tasks");
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
          onClick={() => setActiveWidget("tasks")}>
          <AppIcon name="clock" size={32} /><span>{t.scheduledTasks}</span>
        </button>
        <button type="button" className="set-widget-tile" id={`${panelId}-pomodoro`}
          aria-pressed={activeWidget === "pomodoro"} aria-controls={panelId}
          onClick={() => setActiveWidget("pomodoro")}>
          <AppIcon name="timer" size={32} /><span>{t.pomodoroTitle}</span>
        </button>
      </div>
      <section className="set-widget-panel" id={panelId}
        aria-labelledby={`${panelId}-${activeWidget}`}>
        {panels[activeWidget]}
      </section>
    </div>
  );
}
