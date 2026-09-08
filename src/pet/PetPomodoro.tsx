import { petLayout } from "./petLayout";
import { dict } from "../lib/i18n";
import { pausePomodoro, startPomodoro } from "../lib/pomodoro";
import { usePomodoro } from "../settings/widgets/usePomodoro";
import { AppIcon } from "../ui/AppIcon";
import { PomodoroCountdown } from "../ui/PomodoroCountdown";
import "../theme.css";
import "./pomodoro.css";

export function PetPomodoro({ language, scale = 1 }: { readonly language: string; readonly scale?: number }) {
  const timer = usePomodoro();
  const snapshot = timer.snapshot;
  const t = dict(language);
  const layout = petLayout(scale);
  if (snapshot === null || snapshot.status === "idle") return null;
  const action = {
    running: { label: t.pomodoroPause, icon: "pause", run: pausePomodoro },
    paused: { label: t.pomodoroResume, icon: "play", run: () => startPomodoro(snapshot.preferences) },
    ready: { label: t.pomodoroStart, icon: "play", run: () => startPomodoro(snapshot.preferences) },
  } as const;
  const current = action[snapshot.status];
  return (
    <div className="pet-pomodoro" aria-busy={timer.busy}
      style={{ fontSize: 48 * layout.timerScale, bottom: layout.height * 0.8 }}>
      <div role="timer" aria-label={t.pomodoroRemaining} className="pet-pomodoro-time">
        <PomodoroCountdown remainingMs={snapshot.remainingMs} />
      </div>
      <button type="button" aria-label={current.label} title={current.label}
        disabled={timer.busy} onClick={() => void timer.run(current.run)}>
        <AppIcon name={current.icon} size={20} />
      </button>
      {timer.error && <span role="alert"><button type="button" className="pet-pomodoro-error"
        aria-label={`${t.pomodoroError}: ${t.pomodoroRetry}`} title={`${t.pomodoroError}: ${timer.error.message}`}
        disabled={timer.busy} onClick={timer.retry}><AppIcon name="reset" size={16} /></button></span>}
    </div>
  );
}
