import { AppIcon } from "../../ui/AppIcon";
import { Switch, type TabProps } from "../settingsPrimitives";
import { TimePicker } from "./TimePicker";

export interface ScheduledTaskDraft {
  readonly time: string;
  readonly prompt: string;
}

interface ScheduledTasksWidgetProps extends TabProps {
  readonly draft: ScheduledTaskDraft;
  readonly onDraftChange: (draft: ScheduledTaskDraft) => void;
}

export function ScheduledTasksWidget({ settings, patch, t, draft, onDraftChange }: ScheduledTasksWidgetProps) {
  const tasks = settings.scheduledTasks;
  const addTask = () => {
    const prompt = draft.prompt.trim();
    if (!prompt || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return;
    patch("scheduledTasks", [...tasks, {
      id: `task-${crypto.randomUUID()}`, time: draft.time, prompt, enabled: true,
    }]);
    onDraftChange({ ...draft, prompt: "" });
  };
  return (
    <>
      <h3 className="set-section-head">{t.scheduledTasks}</h3>
      <p className="set-muted">{t.scheduledTasksHint}</p>
      {tasks.map((task) => (
        <div className="set-task" key={task.id}>
          <span className="set-task-time">{task.time}</span>
          <span className="set-task-prompt" title={task.prompt}>{task.prompt}</span>
          <Switch label={t.taskEnable(task.time)} checked={task.enabled}
            onChange={(value) => patch("scheduledTasks",
              tasks.map((item) => item.id === task.id ? { ...item, enabled: value } : item))} />
          <button type="button" className="set-task-delete" aria-label={t.taskDelete}
            title={t.taskDelete} onClick={() => patch("scheduledTasks",
              tasks.filter((item) => item.id !== task.id))}>
            <AppIcon name="delete" size={16} />
          </button>
        </div>
      ))}
      <div className="set-task set-task-new">
        <TimePicker value={draft.time} onChange={(time) => onDraftChange({ ...draft, time })} t={t} />
        <input className="set-input set-task-prompt-input" type="text"
          value={draft.prompt} placeholder={t.taskPromptPlaceholder} aria-label={t.taskPrompt}
          onChange={(event) => onDraftChange({ ...draft, prompt: event.target.value })}
          onKeyDown={(event) => { if (event.key === "Enter") addTask(); }} />
        <button type="button" className="set-task-add" onClick={addTask} disabled={!draft.prompt.trim()}>
          {t.taskAdd}
        </button>
      </div>
    </>
  );
}
